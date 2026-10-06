import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { postAiComments, rotes, settings, users } from '../drizzle/schema';
import { DEFAULT_AI_CONFIG } from '../utils/ai/providers';

const url = process.env.ROTE_PRODUCT_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith('_product_test')) {
  throw new Error('Use a dedicated _product_test database');
}

describe.skipIf(!url)('AI comment persistence and version boundaries', () => {
  let database: typeof import('../utils/drizzle').db;
  let service: typeof import('./service');
  let provider: ReturnType<typeof Bun.serve>;
  let providerCalls = 0;
  let nextAnswer: () => Promise<string> = async () => 'A useful observation.';
  const ownerId = crypto.randomUUID();
  const outsiderId = crypto.randomUUID();
  const noteId = crypto.randomUUID();
  let previousConfig: unknown;

  beforeAll(async () => {
    process.env.POSTGRESQL_URL = url;
    process.env.POSTGRESQL_MIGRATION_URL = url;
    const runtime = await import('../utils/drizzle');
    database = runtime.db;
    await runtime.runMigrations();
    service = await import('./service');
    const [existing] = await database.select().from(settings).where(eq(settings.group, 'ai'));
    previousConfig = existing?.config;
    provider = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(request) {
        if (!new URL(request.url).pathname.endsWith('/chat/completions'))
          return new Response('', { status: 404 });
        providerCalls++;
        const content = await nextAnswer();
        return Response.json({
          choices: [{ message: { role: 'assistant', content } }],
          usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
        });
      },
    });
    const config = {
      ...structuredClone(DEFAULT_AI_CONFIG),
      enabled: true,
      vectorEnabled: false,
      chat: {
        providerId: 'fixture',
        baseUrl: `http://127.0.0.1:${provider.port}/v1`,
        model: 'fixture-comment',
      },
    };
    await database
      .insert(settings)
      .values({ group: 'ai', config })
      .onConflictDoUpdate({ target: settings.group, set: { config } });
    await database
      .insert(users)
      .values(
        [ownerId, outsiderId].map((id) => ({ id, email: `${id}@fixture.invalid`, username: id }))
      );
    await database
      .insert(rotes)
      .values({ id: noteId, authorid: ownerId, content: 'An observation about learning.' });
  });

  afterAll(async () => {
    provider?.stop(true);
    if (!database) return;
    await database.delete(rotes).where(eq(rotes.id, noteId));
    await database.delete(users).where(eq(users.id, ownerId));
    await database.delete(users).where(eq(users.id, outsiderId));
    if (previousConfig)
      await database
        .update(settings)
        .set({ config: previousConfig })
        .where(eq(settings.group, 'ai'));
    else await database.delete(settings).where(eq(settings.group, 'ai'));
    await (await import('../utils/drizzle')).closeDatabase();
  });

  it('stores one comment and replays the same request without calling the model again', async () => {
    const request = crypto.randomUUID();
    const before = providerCalls;
    const first = await service.generatePostComment('rote', noteId, ownerId, request);
    const replay = await service.generatePostComment('rote', noteId, ownerId, request);
    expect(first.id).toBe(replay.id);
    expect(first.status).toBe('completed');
    expect(providerCalls - before).toBe(1);
    expect(await service.listPostComments('rote', noteId, ownerId)).toHaveLength(1);
  });

  it('denies another user and marks old results stale after editing', async () => {
    await expect(service.listPostComments('rote', noteId, outsiderId)).rejects.toBeInstanceOf(
      HTTPException
    );
    const before = providerCalls;
    await expect(
      service.generatePostComment('rote', noteId, outsiderId, crypto.randomUUID())
    ).rejects.toBeInstanceOf(HTTPException);
    expect(providerCalls).toBe(before);
    await database.update(rotes).set({ content: 'A new observation.' }).where(eq(rotes.id, noteId));
    expect((await service.listPostComments('rote', noteId, ownerId))[0].stale).toBe(true);
  });

  it('rejects duplicate generation and does not save a response after the source changes', async () => {
    let finish: (answer: string) => void = () => {};
    let observed: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      observed = resolve;
    });
    nextAnswer = () =>
      new Promise<string>((resolve) => {
        finish = resolve;
        observed();
      });
    const pending = service.generatePostComment('rote', noteId, ownerId, crypto.randomUUID());
    const settlement = pending.then(
      () => null,
      (error: unknown) => error
    );
    await started;
    await expect(
      service.generatePostComment('rote', noteId, ownerId, crypto.randomUUID())
    ).rejects.toMatchObject({ status: 409 });
    await database
      .update(rotes)
      .set({ content: 'Edited during generation.' })
      .where(eq(rotes.id, noteId));
    finish('This answer is outdated.');
    expect(await settlement).toMatchObject({ status: 409, message: 'post_comment_source_changed' });
    const comments = await service.listPostComments('rote', noteId, ownerId);
    expect(
      comments.filter((comment) => comment.content === 'This answer is outdated.')
    ).toHaveLength(0);
    expect(comments.some((comment) => comment.status === 'failed')).toBe(true);
    nextAnswer = async () => 'A useful observation.';
  });

  it('requires exactly one valid target and allows deleting a failed request', async () => {
    await expect(
      database
        .insert(postAiComments)
        .values({
          ownerId,
          requestId: crypto.randomUUID(),
          sourceHash: 'a'.repeat(64),
          status: 'running',
          model: 'fixture',
        })
        .execute()
    ).rejects.toThrow();
    const failed = (await service.listPostComments('rote', noteId, ownerId)).find(
      (comment) => comment.status === 'failed'
    );
    expect(failed).toBeDefined();
    await service.deletePostComment('rote', noteId, ownerId, failed!.id);
    expect(
      (await service.listPostComments('rote', noteId, ownerId)).some(
        (comment) => comment.id === failed!.id
      )
    ).toBe(false);
  });
});
