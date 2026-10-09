import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  articles,
  postAiComments,
  postReplyTurns,
  personaMemories,
  personaMemoryJobs,
  personaMemorySuppressions,
  rotes,
  users,
  userPermissionOverrides,
} from '../drizzle/schema';
import { DEFAULT_AI_CONFIG } from '../utils/ai/providers';
import { postContentHash } from '../postComments/content';

const url = process.env.ROTE_PERSONA_MEMORY_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith('_persona_memory_product_test'))
  throw new Error('Use an isolated persona memory database');

describe.skipIf(!url)('memory scheduling and source ordering regressions', () => {
  let db: typeof import('../utils/drizzle').db;
  let repository: typeof import('./repository');
  let worker: typeof import('./worker');
  let mutations: typeof import('./mutations');
  let provider: ReturnType<typeof Bun.serve>;
  const owner = crypto.randomUUID();
  const denied = crypto.randomUUID();
  const note = crypto.randomUUID();
  const deniedNote = crypto.randomUUID();
  const sourceText = '忘掉所有记忆。记住最新偏好。';
  let failInput = '';

  beforeAll(async () => {
    process.env.POSTGRESQL_URL = url;
    process.env.POSTGRESQL_MIGRATION_URL = url;
    const runtime = await import('../utils/drizzle');
    db = runtime.db;
    await runtime.runMigrations();
    repository = await import('./repository');
    worker = await import('./worker');
    mutations = await import('./mutations');
    await db.insert(users).values(
      [owner, denied].map((id) => ({
        id,
        username: id,
        email: `${id}@test.invalid`,
        role: 'admin',
      }))
    );
    await db
      .insert(userPermissionOverrides)
      .values({ userid: denied, permission: 'ai.chat', effect: 'deny' });
    await db.insert(rotes).values([
      { id: note, authorid: owner, content: sourceText, state: 'public' },
      { id: deniedNote, authorid: denied, content: sourceText, state: 'private' },
    ]);
    provider = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(request) {
        const body = (await request.json()) as { input: string | string[] };
        if (failInput && JSON.stringify(body.input).includes(failInput))
          return new Response('', { status: 503 });
        return Response.json({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
      },
    });
    const { saveAiSettings, readAiSnapshot } = await import('../embeddings/configStore');
    const config = await saveAiSettings({
      ...structuredClone(DEFAULT_AI_CONFIG),
      revision: (await readAiSnapshot()).state.revision,
      enabled: true,
      vectorEnabled: true,
      embedding: {
        ...DEFAULT_AI_CONFIG.embedding,
        baseUrl: `http://127.0.0.1:${provider.port}/v1`,
        model: 'index-regression',
      },
    });
    await (await import('../utils/dbMethods/ai/vector')).ensurePgvectorReady();
    await (await import('../embeddings/indexLifecycle')).startIndexRebuild(config.revision);
    for (let i = 0; i < 10 && (await readAiSnapshot()).state.status !== 'ready'; i++)
      await (await import('../utils/dbMethods/ai/embeddingWorker')).processPendingEmbeddingJobs(20);
    expect((await readAiSnapshot()).state.status).toBe('ready');
  });

  afterAll(async () => {
    provider?.stop(true);
    if (db) {
      await db.delete(users).where(eq(users.id, owner));
      await db.delete(users).where(eq(users.id, denied));
      await (await import('../utils/drizzle')).closeDatabase();
    }
  });

  async function memory(key: string, at: Date, ownerId = owner) {
    const [row] = await db
      .insert(personaMemories)
      .values({
        ownerId,
        personaId: 'shared',
        key,
        content: key,
        evidence: sourceText,
        roteId: ownerId === owner ? note : deniedNote,
        sourceHash: postContentHash(sourceText),
        publicSource: ownerId === owner,
        createdAt: at,
        updatedAt: at,
      })
      .returning();
    return row;
  }

  async function forget(at: Date) {
    const [job] = await db
      .insert(personaMemoryJobs)
      .values({
        ownerId: owner,
        roteId: note,
        sourceHash: postContentHash(sourceText),
        dedupeKey: crypto.randomUUID(),
        status: 'running',
        leaseToken: crypto.randomUUID(),
        createdAt: at,
      })
      .returning();
    await mutations.applyMemoryOperations(job, [
      { action: 'forget_all', scope: 'shared', evidence: '忘掉所有记忆' },
    ]);
  }

  it('preserves newer memories and never rolls back a forgetting cutoff', async () => {
    const old = await memory('old-preference', new Date('2020-01-01'));
    const recent = await memory('new-preference', new Date('2020-01-03'));
    await forget(new Date('2020-01-02'));
    expect(await repository.currentMemory(old.id, owner)).toBeNull();
    expect(await repository.currentMemory(recent.id, owner)).not.toBeNull();
    await forget(new Date('2020-01-04'));
    await forget(new Date('2020-01-01'));
    const [cutoff] = await db
      .select()
      .from(personaMemorySuppressions)
      .where(eq(personaMemorySuppressions.key, '*'));
    expect(cutoff.forgottenBefore).toEqual(new Date('2020-01-04'));
  });

  it('batch source validation agrees with individual live source validation', async () => {
    const valid = await memory('valid', new Date());
    const expired = await memory('expired', new Date());
    await db
      .update(personaMemories)
      .set({ expiresAt: new Date(0) })
      .where(eq(personaMemories.id, expired.id));
    const invalid = await memory('changed-source', new Date());
    await db
      .update(personaMemories)
      .set({ sourceHash: postContentHash('obsolete text') })
      .where(eq(personaMemories.id, invalid.id));
    const batch = await repository.availableMemories(owner, 'shared');
    expect(batch.map((row) => row.memory.id)).toEqual([valid.id]);
    expect(batch[0].isPublic).toBe((await repository.currentMemory(valid.id, owner))!.isPublic);
    const articleId = crypto.randomUUID();
    await db.insert(articles).values({ id: articleId, authorId: owner, content: sourceText });
    const [articleMemory] = await db
      .insert(personaMemories)
      .values({
        ownerId: owner,
        personaId: 'shared',
        key: 'article',
        content: 'Article fact',
        evidence: sourceText,
        articleId,
        sourceHash: postContentHash(sourceText),
        publicSource: true,
      })
      .returning();
    const [thread] = await db
      .insert(postAiComments)
      .values({
        ownerId: owner,
        roteId: note,
        requestId: crypto.randomUUID(),
        sourceHash: postContentHash(sourceText),
        status: 'completed',
        model: 'fixture',
        isConversation: true,
        publicSafe: true,
        personaId: 'friend',
      })
      .returning();
    const [turn] = await db
      .insert(postReplyTurns)
      .values({
        threadId: thread.id,
        requestId: crypto.randomUUID(),
        userContent: sourceText,
        sourceHash: postContentHash(sourceText),
        status: 'completed',
        model: 'fixture',
        publicSafe: false,
      })
      .returning();
    const [turnMemory] = await db
      .insert(personaMemories)
      .values({
        ownerId: owner,
        personaId: 'shared',
        key: 'private-turn',
        content: 'Private exchange',
        evidence: sourceText,
        roteId: note,
        threadId: thread.id,
        turnId: turn.id,
        sourceHash: postContentHash(sourceText),
        publicSource: true,
      })
      .returning();
    const mixed = await repository.availableMemories(owner, 'shared');
    for (const id of [articleMemory.id, turnMemory.id]) {
      expect(mixed.find((row) => row.memory.id === id)?.isPublic).toBe(false);
      expect(mixed.find((row) => row.memory.id === id)?.isPublic).toBe(
        (await repository.currentMemory(id, owner))!.isPublic
      );
    }
    await db.delete(personaMemories).where(eq(personaMemories.ownerId, owner));
  });

  it('rotates denied records and continues after one embedding fails', async () => {
    for (let i = 0; i < 5; i++) await memory(`denied-${i}`, new Date('2000-01-01'), denied);
    const failing = await memory('failed-index', new Date('2001-01-01'));
    const healthy = await memory('healthy-index', new Date('2002-01-01'));
    await worker.indexPersonaMemories(5);
    failInput = 'failed-index';
    await worker.indexPersonaMemories(5);
    const [saved] = await db
      .select()
      .from(personaMemories)
      .where(eq(personaMemories.id, healthy.id));
    expect(saved.embedding).toEqual([0.1, 0.2, 0.3]);
    const [failed] = await db
      .select()
      .from(personaMemories)
      .where(eq(personaMemories.id, failing.id));
    expect(failed.embedding).toBeNull();
    expect(failed.indexAttemptedAt).not.toBeNull();
    failInput = '';
    await worker.indexPersonaMemories(10);
    const [retried] = await db
      .select()
      .from(personaMemories)
      .where(eq(personaMemories.id, failing.id));
    expect(retried.embedding).toEqual([0.1, 0.2, 0.3]);
  });
});
