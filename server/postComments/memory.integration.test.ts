import { afterAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { DEFAULT_AI_CONFIG } from '../utils/ai/providers';

const url = process.env.ROTE_MEMORY_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith('_memory_product_test'))
  throw new Error('Use an isolated memory test database');

describe.skipIf(!url)('persona vector memory with real PostgreSQL', () => {
  it('retrieves only public own history, shares automatic retrieval and rechecks visibility on save', async () => {
    process.env.POSTGRESQL_URL = url;
    process.env.POSTGRESQL_MIGRATION_URL = url;
    const { db, runMigrations } = await import('../utils/drizzle');
    await runMigrations();
    const { users, rotes, articles } = await import('../drizzle/schema');
    const { saveAiSettings, readAiSnapshot } = await import('../embeddings/configStore');
    const { startIndexRebuild } = await import('../embeddings/indexLifecycle');
    const { ensurePgvectorReady } = await import('../utils/dbMethods/ai/vector');
    const { processPendingEmbeddingJobs } = await import('../utils/dbMethods/ai/embeddingWorker');
    const { retrieveReplyMemory } = await import('./memory');
    const { createAutomaticReply } = await import('./automatic');
    const { generatePostComment } = await import('./service');
    const { continuePostReply } = await import('./conversations');
    const { listPostReplies } = await import('./conversations');
    const owner = crypto.randomUUID();
    const outsider = crypto.randomUUID();
    const target = crypto.randomUUID();
    const history = crypto.randomUUID();
    const article = crypto.randomUUID();
    let embeddingCalls = 0;
    let captured: { role: string; content: string }[][] = [];
    let onChat = async () => {};
    let embeddingFails = false;
    const provider = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(request) {
        if (new URL(request.url).pathname.endsWith('/embeddings')) {
          embeddingCalls++;
          if (embeddingFails) return new Response('', { status: 503 });
          return Response.json({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
        }
        const body = (await request.json()) as { messages: (typeof captured)[number] };
        captured.push(body.messages);
        await onChat();
        return Response.json({ choices: [{ message: { content: 'A relevant reply.' } }] });
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
      await db
        .insert(articles)
        .values({ id: article, authorId: owner, content: 'published article history' });
      await db.insert(rotes).values([
        { id: target, authorid: owner, content: 'today learning', state: 'public' },
        { id: history, authorid: owner, content: 'previous learning history', state: 'public' },
        { authorid: owner, content: 'secret private history', state: 'private' },
        { authorid: outsider, content: 'outsider public history', state: 'public' },
        { authorid: owner, content: 'archived public history', state: 'public', archived: true },
        { authorid: owner, content: 'article publication', state: 'public', articleId: article },
      ]);
      let config = await saveAiSettings({
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
      const notReadyCalls = embeddingCalls;
      expect(await retrieveReplyMemory('rote', target, owner, 'learning')).toEqual({
        message: '',
        sources: [],
      });
      expect(embeddingCalls).toBe(notReadyCalls);
      await ensurePgvectorReady();
      await startIndexRebuild(config.revision);
      for (let i = 0; i < 10 && (await readAiSnapshot()).state.status !== 'ready'; i++)
        await processPendingEmbeddingJobs(20);
      expect((await readAiSnapshot()).state.status).toBe('ready');
      const memory = await retrieveReplyMemory('rote', target, owner, 'learning');
      expect(memory.sources).toHaveLength(3);
      expect(memory.message).toContain('previous learning history');
      expect(memory.message).toContain('published article history');
      for (const excluded of ['secret private', 'outsider', 'archived public', 'today learning'])
        expect(memory.message).not.toContain(excluded);
      const articleMemory = await retrieveReplyMemory('article', article, owner, 'article');
      expect(articleMemory.message).not.toContain('article publication');
      expect(articleMemory.message).not.toContain('published article history');
      const before = embeddingCalls;
      captured = [];
      await createAutomaticReply('rote', target, owner);
      expect(embeddingCalls - before).toBe(1);
      expect(captured.length).toBeGreaterThanOrEqual(1);
      expect(captured.length).toBeLessThanOrEqual(3);
      expect(new Set(captured.map((messages) => messages[1].content)).size).toBe(1);
      const [thread] = await listPostReplies('rote', target, owner);
      await continuePostReply(
        'rote',
        target,
        owner,
        thread.id,
        crypto.randomUUID(),
        'What about my earlier learning?'
      );
      expect(captured.at(-1)?.[1].content).toContain('previous learning history');
      onChat = async () => {
        await db.update(rotes).set({ state: 'private' }).where(eq(rotes.id, history));
      };
      await expect(
        continuePostReply(
          'rote',
          target,
          owner,
          thread.id,
          crypto.randomUUID(),
          'Remember earlier learning?'
        )
      ).rejects.toMatchObject({ status: 409 });
      onChat = async () => {};
      const stale = await retrieveReplyMemory('rote', target, owner, 'learning');
      expect(stale.message).not.toContain('previous learning history');
      await db
        .update(articles)
        .set({ content: 'replacement article' })
        .where(eq(articles.id, article));
      expect((await retrieveReplyMemory('rote', target, owner, 'learning')).message).not.toContain(
        'published article history'
      );
      embeddingFails = true;
      const failureTarget = crypto.randomUUID();
      await db
        .insert(rotes)
        .values({ id: failureTarget, authorid: owner, content: 'learning with provider failure' });
      const generated = await generatePostComment(
        'rote',
        failureTarget,
        owner,
        crypto.randomUUID(),
        { conversation: true }
      );
      expect(generated.status).toBe('completed');
      expect(captured.at(-1)).toHaveLength(2);
      config = await saveAiSettings({ ...config, vectorEnabled: false });
      const disabledCalls = embeddingCalls;
      expect(await retrieveReplyMemory('rote', target, owner, 'learning')).toEqual({
        message: '',
        sources: [],
      });
      expect(embeddingCalls).toBe(disabledCalls);
    } finally {
      provider.stop(true);
      await db.delete(rotes).where(eq(rotes.authorid, owner));
      await db.delete(rotes).where(eq(rotes.authorid, outsider));
      await db.delete(articles).where(eq(articles.authorId, owner));
      await db.delete(users).where(eq(users.id, owner));
      await db.delete(users).where(eq(users.id, outsider));
    }
  }, 60000);
  afterAll(async () => {
    if (url) await (await import('../utils/drizzle')).closeDatabase();
  });
});
