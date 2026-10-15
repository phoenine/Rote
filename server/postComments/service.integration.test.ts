import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { articles, postAiComments, rotes, settings, users } from '../drizzle/schema';
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
  let messages: { role: string; content: string }[] = [];
  const automaticNoteId = crypto.randomUUID();
  const articleId = crypto.randomUUID();

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
        messages = ((await request.json()) as { messages: typeof messages }).messages;
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
    await database.delete(rotes).where(eq(rotes.id, automaticNoteId));
    await database.delete(articles).where(eq(articles.id, articleId));
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

  it('keeps legacy critiques private, limits distinct roles, and follows post visibility', async () => {
    const conversation = await import('./conversations');
    await database.update(rotes).set({ state: 'public' }).where(eq(rotes.id, noteId));
    const threads = await Promise.all(
      Array.from({ length: 3 }, () =>
        service.generatePostComment('rote', noteId, ownerId, crypto.randomUUID(), {
          conversation: true,
        })
      )
    );
    expect(new Set(threads.map((thread) => thread.personaId)).size).toBe(3);
    await expect(
      service.generatePostComment('rote', noteId, ownerId, crypto.randomUUID(), {
        conversation: true,
      })
    ).rejects.toMatchObject({ status: 409, message: 'post_reply_role_limit' });
    const visible = await conversation.listPostReplies('rote', noteId);
    expect(visible).toHaveLength(3);
    expect(visible.every((thread) => !thread.legacy)).toBe(true);
    expect(
      (await conversation.listPostReplies('rote', noteId, ownerId)).some((thread) => thread.legacy)
    ).toBe(true);
    const router = (await import('../route/v2/postReplies')).default;
    expect((await router.request(`/rote/${noteId}`)).status).toBe(200);
    expect(
      (
        await router.request(`/rote/${noteId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status
    ).toBe(401);
    await database.update(rotes).set({ state: 'private' }).where(eq(rotes.id, noteId));
    await expect(conversation.listPostReplies('rote', noteId)).rejects.toMatchObject({
      status: 404,
    });
    await database.update(rotes).set({ state: 'public' }).where(eq(rotes.id, noteId));
  });

  it('persists dialogue, replays requests, keeps the role, and retries a failed reply without duplicating the author', async () => {
    const conversation = await import('./conversations');
    const [thread] = (await conversation.listPostReplies('rote', noteId, ownerId)).filter(
      (row) => !row.legacy
    );
    const requestId = crypto.randomUUID();
    const before = providerCalls;
    const first = await conversation.continuePostReply(
      'rote',
      noteId,
      ownerId,
      thread.id,
      requestId,
      'Tell me more'
    );
    const replay = await conversation.continuePostReply(
      'rote',
      noteId,
      ownerId,
      thread.id,
      requestId,
      'Tell me more'
    );
    expect(first.id).toBe(replay.id);
    expect(providerCalls - before).toBe(1);
    await expect(
      conversation.continuePostReply(
        'rote',
        noteId,
        outsiderId,
        thread.id,
        crypto.randomUUID(),
        'Hello'
      )
    ).rejects.toMatchObject({ status: 404 });
    const failureId = crypto.randomUUID();
    nextAnswer = async () => '';
    await expect(
      conversation.continuePostReply(
        'rote',
        noteId,
        ownerId,
        thread.id,
        failureId,
        'Keep this author comment'
      )
    ).rejects.toMatchObject({ status: 502 });
    let saved = (await conversation.listPostReplies('rote', noteId, ownerId)).find(
      (row) => row.id === thread.id
    )!;
    expect(saved.turns).toHaveLength(2);
    expect(saved.turns[1].userContent).toBe('Keep this author comment');
    expect(saved.turns[1].status).toBe('failed');
    const createdAt = saved.turns[1].createdAt;
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
    const pending = conversation.continuePostReply(
      'rote',
      noteId,
      ownerId,
      thread.id,
      crypto.randomUUID(),
      'Another message'
    );
    await started;
    await expect(
      conversation.continuePostReply(
        'rote',
        noteId,
        ownerId,
        thread.id,
        failureId,
        'Keep this author comment',
        true
      )
    ).rejects.toMatchObject({ status: 409, message: 'post_comment_running' });
    finish('Another answer');
    await pending;

    nextAnswer = async () => 'I hear you.';
    await conversation.continuePostReply(
      'rote',
      noteId,
      ownerId,
      thread.id,
      failureId,
      'Keep this author comment',
      true
    );
    expect(messages.some((message) => message.content === 'Tell me more')).toBe(true);
    expect(messages[0].content).toBe(
      (await import('./personas')).replySystemPrompt(thread.personaId!)
    );
    saved = (await conversation.listPostReplies('rote', noteId, ownerId)).find(
      (row) => row.id === thread.id
    )!;
    expect(saved.turns).toHaveLength(3);
    expect(saved.turns[1].status).toBe('completed');
    expect(saved.turns[1].createdAt).toEqual(createdAt);
    const publicThread = (await conversation.listPostReplies('rote', noteId)).find(
      (row) => row.id === thread.id
    )!;
    expect(publicThread.turns.every((turn) => turn.requestId === undefined)).toBe(true);
  });

  it('automatically opens one to three roles once and supports image-only posts', async () => {
    await database.update(users).set({ role: 'admin' }).where(eq(users.id, ownerId));
    await database
      .insert(rotes)
      .values({ id: automaticNoteId, authorid: ownerId, content: '', state: 'public' });
    const { createAutomaticReply } = await import('./automatic');
    const { listPostReplies } = await import('./conversations');
    const before = providerCalls;
    await createAutomaticReply('rote', automaticNoteId, ownerId);
    const threads = await listPostReplies('rote', automaticNoteId);
    expect(threads.length).toBeGreaterThanOrEqual(1);
    expect(threads.length).toBeLessThanOrEqual(3);
    expect(providerCalls - before).toBe(threads.length);
    await createAutomaticReply('rote', automaticNoteId, ownerId);
    expect(providerCalls - before).toBe(threads.length);
    expect(new Set(threads.map((thread) => thread.personaId)).size).toBe(threads.length);
  });

  it('supports article conversations with private visibility and cascades deletion', async () => {
    await database
      .insert(articles)
      .values({ id: articleId, authorId: ownerId, content: 'An article to talk about.' });
    const { listPostReplies, continuePostReply } = await import('./conversations');
    const thread = await service.generatePostComment(
      'article',
      articleId,
      ownerId,
      crypto.randomUUID(),
      { conversation: true }
    );
    await expect(listPostReplies('article', articleId)).rejects.toMatchObject({ status: 404 });
    await continuePostReply(
      'article',
      articleId,
      ownerId,
      thread.id,
      crypto.randomUUID(),
      'An article comment'
    );
    expect((await listPostReplies('article', articleId, ownerId))[0].turns).toHaveLength(1);
    await service.deletePostComment('article', articleId, ownerId, thread.id);
    expect(await listPostReplies('article', articleId, ownerId)).toHaveLength(0);
  });

  it('does not publish private conversations or private history when a post becomes public', async () => {
    const { listPostReplies, continuePostReply } = await import('./conversations');
    const privateId = crypto.randomUUID();
    nextAnswer = async () => 'Private context from another record.';
    await database
      .insert(rotes)
      .values({ id: privateId, authorid: ownerId, content: 'A post', state: 'private' });
    const privateThread = await service.generatePostComment(
      'rote',
      privateId,
      ownerId,
      crypto.randomUUID(),
      { conversation: true }
    );
    expect(privateThread.publicSafe).toBe(false);
    await database.update(rotes).set({ state: 'public' }).where(eq(rotes.id, privateId));
    expect(await listPostReplies('rote', privateId)).toHaveLength(0);
    expect(await listPostReplies('rote', privateId, ownerId)).toHaveLength(1);

    nextAnswer = async () => 'A public answer.';
    const publicThread = await service.generatePostComment(
      'rote',
      privateId,
      ownerId,
      crypto.randomUUID(),
      { conversation: true }
    );
    expect(publicThread.publicSafe).toBe(true);
    await database.update(rotes).set({ state: 'private' }).where(eq(rotes.id, privateId));
    const privateTurn = await continuePostReply(
      'rote',
      privateId,
      ownerId,
      publicThread.id,
      crypto.randomUUID(),
      'Private author message'
    );
    expect(privateTurn.publicSafe).toBe(false);
    await database.update(rotes).set({ state: 'public' }).where(eq(rotes.id, privateId));
    const inherited = await continuePostReply(
      'rote',
      privateId,
      ownerId,
      publicThread.id,
      crypto.randomUUID(),
      'Continue this conversation'
    );
    expect(inherited.publicSafe).toBe(false);
    const visible = await listPostReplies('rote', privateId);
    expect(visible).toHaveLength(1);
    expect(visible[0].turns).toHaveLength(0);
    expect(
      (await listPostReplies('rote', privateId, ownerId)).find(
        (thread) => thread.id === publicThread.id
      )?.turns
    ).toHaveLength(2);
    await database
      .update(postAiComments)
      .set({ publicSafe: false })
      .where(eq(postAiComments.id, publicThread.id));
    expect(await listPostReplies('rote', privateId)).toHaveLength(0);
  });
});
