import { afterAll, describe, expect, it } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { DEFAULT_AI_CONFIG } from '../utils/ai/providers';
import type { ExistingMemory, MemoryOperation } from './extraction';

const url = process.env.ROTE_PERSONA_MEMORY_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith('_persona_memory_product_test'))
  throw new Error('Use an isolated persona memory database');

describe.skipIf(!url)('automatic persona memory end-to-end', () => {
  it('extracts, indexes and recalls shared and role-specific memory with correction, privacy, forgetting and deletion', async () => {
    process.env.POSTGRESQL_URL = url;
    process.env.POSTGRESQL_MIGRATION_URL = url;
    const { db, runMigrations } = await import('../utils/drizzle');
    await runMigrations();
    const { users, rotes, postAiComments, postReplyTurns, personaMemories, personaMemoryJobs } =
      await import('../drizzle/schema');
    const { saveAiSettings, readAiSnapshot } = await import('../embeddings/configStore');
    const { ensurePgvectorReady } = await import('../utils/dbMethods/ai/vector');
    const { startIndexRebuild } = await import('../embeddings/indexLifecycle');
    const { processPendingEmbeddingJobs } = await import('../utils/dbMethods/ai/embeddingWorker');
    const { generatePostComment } = await import('../postComments/service');
    const { continuePostReply } = await import('../postComments/conversations');
    const { retrieveReplyMemory } = await import('../postComments/memory');
    const { selectPersonaMemory } = await import('../postComments/memoryContext');
    const { processMemoryJobs, indexPersonaMemories } = await import('./worker');
    const { currentMemory, claimMemoryJob } = await import('./repository');
    const owner = crypto.randomUUID();
    const outsider = crypto.randomUUID();
    const origin = crypto.randomUUID();
    const target = crypto.randomUUID();
    const privateNote = crypto.randomUUID();
    let extractionCalls = 0;
    let malformed = false;
    let onChat = async () => {};
    const replyContexts: string[] = [];
    type Messages = { role: string; content: string }[];
    const provider = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(request) {
        if (new URL(request.url).pathname.endsWith('/embeddings'))
          return Response.json({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
        const body = (await request.json()) as { messages: Messages };
        let content = 'A friendly reply.';
        if (body.messages[0].content.startsWith('Extract useful memories')) {
          extractionCalls++;
          const input = JSON.parse(body.messages[1].content) as {
            authorText: string;
            existing: ExistingMemory[];
          };
          const operations: MemoryOperation[] = [];
          if (input.authorText === '我喜欢简短回复。')
            operations.push({
              action: 'remember',
              scope: 'shared',
              key: 'reply-length',
              content: '喜欢简短回复',
              evidence: input.authorText,
              ttlDays: null,
            });
          if (input.authorText === '我喜欢你写两行小诗。')
            operations.push({
              action: 'remember',
              scope: 'persona',
              key: 'poetry',
              content: '喜欢小晴写两行小诗',
              evidence: input.authorText,
              ttlDays: null,
            });
          if (input.authorText === '我最近准备换工作。')
            operations.push({
              action: 'remember',
              scope: 'shared',
              key: 'job-plan',
              content: '最近准备换工作',
              evidence: input.authorText,
              ttlDays: 30,
            });
          if (input.authorText === '更正，我现在喜欢详细回复。')
            operations.push({
              action: 'remember',
              scope: 'shared',
              key: 'new-length',
              replaces: input.existing.find((item) => item.key === 'reply-length')!.id,
              content: '现在喜欢详细回复',
              evidence: input.authorText,
              ttlDays: null,
            });
          if (input.authorText === '忘掉我喜欢详细回复这件事。')
            operations.push({
              action: 'forget',
              scope: 'shared',
              id: input.existing.find((item) => item.key === 'reply-length')!.id,
              evidence: input.authorText,
            });
          content = malformed ? 'invalid JSON' : JSON.stringify({ operations });
        } else {
          replyContexts.push(body.messages.map((message) => message.content).join('\n'));
          await onChat();
        }
        return Response.json({ choices: [{ message: { content } }] });
      },
    });
    try {
      await db.insert(users).values(
        [owner, outsider].map((id) => ({
          id,
          username: id,
          email: `${id}@test.invalid`,
          role: 'admin' as const,
        }))
      );
      await db.insert(rotes).values([
        { id: origin, authorid: owner, content: '我喜欢简短回复。', state: 'public' },
        { id: target, authorid: owner, content: '今天写诗。', state: 'public' },
        { id: privateNote, authorid: owner, content: '我最近准备换工作。', state: 'private' },
      ]);
      const config = await saveAiSettings({
        ...structuredClone(DEFAULT_AI_CONFIG),
        revision: (await readAiSnapshot()).state.revision,
        enabled: true,
        vectorEnabled: true,
        chat: {
          providerId: 'fixture',
          baseUrl: `http://127.0.0.1:${provider.port}/v1`,
          model: 'fixture',
        },
        embedding: {
          ...DEFAULT_AI_CONFIG.embedding,
          baseUrl: `http://127.0.0.1:${provider.port}/v1`,
          model: 'fixture',
        },
      });
      await ensurePgvectorReady();
      await startIndexRebuild(config.revision);
      for (let i = 0; i < 10 && (await readAiSnapshot()).state.status !== 'ready'; i++)
        await processPendingEmbeddingJobs(20);
      expect((await readAiSnapshot()).state.status).toBe('ready');
      const requestId = crypto.randomUUID();
      await generatePostComment('rote', origin, owner, requestId, { conversation: true });
      await generatePostComment('rote', origin, owner, requestId, { conversation: true });
      await generatePostComment('rote', origin, owner, crypto.randomUUID(), { conversation: true });
      await generatePostComment('rote', origin, owner, crypto.randomUUID(), { conversation: true });
      expect(
        await db.select().from(personaMemoryJobs).where(eq(personaMemoryJobs.roteId, origin))
      ).toHaveLength(1);
      await processMemoryJobs();
      await indexPersonaMemories();
      expect(extractionCalls).toBe(1);
      let rows = await db.select().from(personaMemories).where(eq(personaMemories.ownerId, owner));
      expect(rows).toHaveLength(1);
      const commonId = rows[0].id;
      expect(rows[0].embedding).toEqual([0.1, 0.2, 0.3]);
      const thread = await generatePostComment('rote', target, owner, crypto.randomUUID(), {
        conversation: true,
      });
      await db
        .update(postAiComments)
        .set({ personaId: 'friend' })
        .where(eq(postAiComments.id, thread.id));
      await processMemoryJobs();
      expect(replyContexts.at(-1)).toContain('简短回复');
      const poetryTurn = await continuePostReply(
        'rote',
        target,
        owner,
        thread.id,
        crypto.randomUUID(),
        '我喜欢你写两行小诗。'
      );
      await processMemoryJobs();
      await indexPersonaMemories();
      let retrieved = await retrieveReplyMemory('rote', target, owner, '回复');
      expect(selectPersonaMemory(retrieved, 'friend').message).toContain('小晴');
      expect(selectPersonaMemory(retrieved, 'reader').message).not.toContain('小晴');
      expect(selectPersonaMemory(retrieved, 'reader').message).toContain('简短回复');
      await generatePostComment('rote', privateNote, owner, crypto.randomUUID(), {
        conversation: true,
      });
      await processMemoryJobs();
      await indexPersonaMemories();
      retrieved = await retrieveReplyMemory('rote', target, owner, '工作');
      expect(selectPersonaMemory(retrieved, 'friend').message).not.toContain('换工作');
      const privateMemory = selectPersonaMemory(
        await retrieveReplyMemory('rote', privateNote, owner, '工作'),
        'reader'
      );
      expect(privateMemory.message).toContain('换工作');
      expect((await retrieveReplyMemory('rote', target, outsider, '工作')).message).toBe('');
      await continuePostReply(
        'rote',
        target,
        owner,
        thread.id,
        crypto.randomUUID(),
        '更正，我现在喜欢详细回复。'
      );
      expect(replyContexts.at(-1)).toContain('小晴');
      await processMemoryJobs();
      await indexPersonaMemories();
      rows = await db
        .select()
        .from(personaMemories)
        .where(and(eq(personaMemories.ownerId, owner), eq(personaMemories.key, 'reply-length')));
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(commonId);
      expect(rows[0].content).toContain('详细');
      const switched = await saveAiSettings({
        ...config,
        embedding: { ...config.embedding, model: 'fixture-new-generation' },
      });
      await startIndexRebuild(switched.revision);
      for (let i = 0; i < 10 && (await readAiSnapshot()).state.status !== 'ready'; i++)
        await processPendingEmbeddingJobs(20);
      expect(
        selectPersonaMemory(await retrieveReplyMemory('rote', target, owner, '回复'), 'reader')
          .message
      ).not.toContain('现在喜欢详细回复');
      await indexPersonaMemories();
      expect(
        selectPersonaMemory(await retrieveReplyMemory('rote', target, owner, '回复'), 'reader')
          .message
      ).toContain('现在喜欢详细回复');
      await continuePostReply(
        'rote',
        target,
        owner,
        thread.id,
        crypto.randomUUID(),
        '忘掉我喜欢详细回复这件事。'
      );
      await processMemoryJobs();
      expect(await currentMemory(commonId, owner)).toBeNull();
      expect(
        selectPersonaMemory(await retrieveReplyMemory('rote', origin, owner, '回复'), 'reader')
          .message
      ).not.toContain('详细回复');
      const [jobMemory] = await db
        .select()
        .from(personaMemories)
        .where(and(eq(personaMemories.ownerId, owner), eq(personaMemories.key, 'job-plan')));
      await db
        .update(personaMemories)
        .set({ expiresAt: new Date(0) })
        .where(eq(personaMemories.id, jobMemory.id));
      expect(await currentMemory(jobMemory.id, owner)).toBeNull();
      await db.delete(postReplyTurns).where(eq(postReplyTurns.id, poetryTurn.id));
      expect(
        await db
          .select()
          .from(personaMemories)
          .where(and(eq(personaMemories.ownerId, owner), eq(personaMemories.personaId, 'friend')))
      ).toHaveLength(0);
      malformed = true;
      const saved = await continuePostReply(
        'rote',
        target,
        owner,
        thread.id,
        crypto.randomUUID(),
        '新的话题'
      );
      await processMemoryJobs();
      expect(saved.status).toBe('completed');
      expect(
        (await db.select().from(personaMemoryJobs).where(eq(personaMemoryJobs.turnId, saved.id)))[0]
          .status
      ).toBe('failed');
      malformed = false;
      const pendingTurn = await continuePostReply(
        'rote',
        target,
        owner,
        thread.id,
        crypto.randomUUID(),
        '没有新记忆'
      );
      const claimed = await claimMemoryJob();
      expect(await claimMemoryJob()).toBeNull();
      expect(claimed?.turnId).toBe(pendingTurn.id);
      await db
        .update(personaMemoryJobs)
        .set({ startedAt: new Date(0) })
        .where(eq(personaMemoryJobs.id, claimed!.id));
      await claimMemoryJob();
      expect(
        (await db.select().from(personaMemoryJobs).where(eq(personaMemoryJobs.id, claimed!.id)))[0]
          .status
      ).toBe('failed');
      // A private-to-public edit during a reply must not publish private memory.
      await db
        .update(personaMemories)
        .set({ expiresAt: null })
        .where(eq(personaMemories.id, jobMemory.id));
      onChat = async () => {
        await db.update(rotes).set({ state: 'public' }).where(eq(rotes.id, privateNote));
      };
      await expect(
        generatePostComment('rote', privateNote, owner, crypto.randomUUID(), { conversation: true })
      ).rejects.toMatchObject({ status: 409 });
      onChat = async () => {};
      await db.delete(rotes).where(eq(rotes.id, privateNote));
      expect(
        await db.select().from(personaMemories).where(eq(personaMemories.id, jobMemory.id))
      ).toHaveLength(0);
    } finally {
      provider.stop(true);
      await db.delete(users).where(eq(users.id, owner));
      await db.delete(users).where(eq(users.id, outsider));
    }
  }, 60000);
  afterAll(async () => {
    if (url) await (await import('../utils/drizzle')).closeDatabase();
  });
});
