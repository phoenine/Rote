import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { lockDatabaseOwner } from '../database/ownerLock';
import { postAiComments, postReplyTurns } from '../drizzle/schema';
import { createChatCompletion, type ChatMessage } from '../utils/ai/client';
import { getStoredAiConfig } from '../utils/dbMethods/ai/config';
import { logAiTokenUsage } from '../utils/dbMethods/aiToken';
import { findArticleById, findRoteById, getNoteByArticleId } from '../utils/dbMethods';
import db from '../utils/drizzle';
import { postContentHash, requireCommentableText, type PostKind } from './content';
import { replySystemPrompt } from './personas';
import { ownedPost, targetFilter } from './service';

async function visiblePost(kind: PostKind, id: string, viewerId?: string) {
  if (kind === 'rote') {
    const post = await findRoteById(id, viewerId);
    if (post && (post.authorid === viewerId || post.state === 'public'))
      return { content: post.content as string, ownerId: post.authorid as string };
  } else {
    const post = await findArticleById(id, viewerId);
    if (post) {
      const note = await getNoteByArticleId(id, viewerId);
      if (post.authorId === viewerId || note?.state === 'public')
        return { content: post.content as string, ownerId: post.authorId as string };
    }
  }
  throw new HTTPException(404, { message: 'post_comment_not_found' });
}

export async function listPostReplies(kind: PostKind, id: string, viewerId?: string) {
  const post = await visiblePost(kind, id, viewerId);
  const owner = post.ownerId === viewerId;
  // Legacy private critiques never become public merely because their post is public.
  const threads = await db
    .select()
    .from(postAiComments)
    .where(
      and(
        targetFilter(kind, id, post.ownerId),
        owner ? undefined : eq(postAiComments.isConversation, true)
      )
    )
    .orderBy(asc(postAiComments.createdAt), asc(postAiComments.id));
  if (owner && threads.length) {
    const ids = threads.map((thread) => thread.id);
    await db
      .update(postAiComments)
      .set({ status: 'failed' })
      .where(
        and(
          inArray(postAiComments.id, ids),
          eq(postAiComments.status, 'running'),
          sql`${postAiComments.createdAt} < now() - interval '2 minutes'`
        )
      );
    await db
      .update(postReplyTurns)
      .set({ status: 'failed' })
      .where(
        and(
          inArray(postReplyTurns.threadId, ids),
          eq(postReplyTurns.status, 'running'),
          sql`${postReplyTurns.startedAt} < now() - interval '2 minutes'`
        )
      );
  }
  const turns = threads.length
    ? await db
        .select()
        .from(postReplyTurns)
        .where(
          inArray(
            postReplyTurns.threadId,
            threads.map((thread) => thread.id)
          )
        )
        .orderBy(asc(postReplyTurns.createdAt), asc(postReplyTurns.id))
    : [];
  const hash = postContentHash(post.content);
  return threads.map((thread) => ({
    id: thread.id,
    personaId: thread.personaId,
    legacy: !thread.isConversation,
    content: thread.content,
    status:
      owner && thread.status === 'running' && Date.now() - thread.createdAt.getTime() > 120000
        ? 'failed'
        : thread.status,
    createdAt: thread.createdAt,
    stale: hash !== thread.sourceHash,
    turns: turns
      .filter((turn) => turn.threadId === thread.id)
      .map((turn) => ({
        id: turn.id,
        userContent: turn.userContent,
        replyContent: turn.replyContent,
        status: turn.status,
        requestId: owner ? turn.requestId : undefined,
        createdAt: turn.createdAt,
        stale: hash !== turn.sourceHash,
      })),
  }));
}

export async function continuePostReply(
  kind: PostKind,
  id: string,
  ownerId: string,
  threadId: string,
  requestId: string,
  content: string,
  retry = false
) {
  const trimmed = content.trim();
  if (!trimmed || trimmed.length > 4000)
    throw new HTTPException(422, { message: 'post_reply_invalid_content' });
  const config = await getStoredAiConfig();
  const started = await db.transaction(async (transaction) => {
    await lockDatabaseOwner(transaction, ownerId);
    const post = await ownedPost(kind, id, ownerId, transaction, true);
    requireCommentableText(post.content);
    const [thread] = await transaction
      .select()
      .from(postAiComments)
      .where(
        and(
          targetFilter(kind, id, ownerId),
          eq(postAiComments.id, threadId),
          eq(postAiComments.isConversation, true)
        )
      )
      .for('update');
    if (!thread?.personaId || thread.status !== 'completed')
      throw new HTTPException(409, { message: 'post_reply_thread_unavailable' });
    const [replay] = await transaction
      .select()
      .from(postReplyTurns)
      .where(and(eq(postReplyTurns.threadId, threadId), eq(postReplyTurns.requestId, requestId)));
    if (replay) {
      if (replay.userContent !== trimmed)
        throw new HTTPException(409, { message: 'post_comment_request_conflict' });
      if (retry && replay.status === 'failed') {
        const [running] = await transaction
          .select({ id: postReplyTurns.id })
          .from(postReplyTurns)
          .where(and(eq(postReplyTurns.threadId, threadId), eq(postReplyTurns.status, 'running')));
        if (running) throw new HTTPException(409, { message: 'post_comment_running' });
        const [retrying] = await transaction
          .update(postReplyTurns)
          .set({
            status: 'running',
            sourceHash: postContentHash(post.content),
            model: config.chat.model || thread.model,
            startedAt: new Date(),
          })
          .where(eq(postReplyTurns.id, replay.id))
          .returning();
        return { turn: retrying, thread, source: post.content, generate: true };
      }
      return { turn: replay, thread, source: post.content, generate: false };
    }
    const [running] = await transaction
      .select({ id: postReplyTurns.id })
      .from(postReplyTurns)
      .where(and(eq(postReplyTurns.threadId, threadId), eq(postReplyTurns.status, 'running')));
    if (running) throw new HTTPException(409, { message: 'post_comment_running' });
    // Persist the author's comment even if AI is unavailable; its failure is separate.
    const [turn] = await transaction
      .insert(postReplyTurns)
      .values({
        threadId,
        requestId,
        userContent: trimmed,
        status: 'running',
        model: config.chat.model || thread.model,
        sourceHash: postContentHash(post.content),
      })
      .returning();
    return { turn, thread, source: post.content, generate: true };
  });
  if (!started.generate) return started.turn;
  return finishTurn(kind, id, ownerId, started, config);
}

type StartedTurn = {
  turn: typeof postReplyTurns.$inferSelect;
  thread: typeof postAiComments.$inferSelect;
  source: string;
};

async function finishTurn(
  kind: PostKind,
  id: string,
  ownerId: string,
  started: StartedTurn,
  config: Awaited<ReturnType<typeof getStoredAiConfig>>
) {
  try {
    if (!config.enabled || !config.chat.baseUrl || !config.chat.model)
      throw new HTTPException(503, { message: 'post_comment_ai_unavailable' });
    const history = await db
      .select()
      .from(postReplyTurns)
      .where(
        and(eq(postReplyTurns.threadId, started.thread.id), eq(postReplyTurns.status, 'completed'))
      )
      .orderBy(desc(postReplyTurns.createdAt), desc(postReplyTurns.id))
      .limit(8);
    const messages: ChatMessage[] = [
      { role: 'system', content: replySystemPrompt(started.thread.personaId!) },
      { role: 'user', content: started.source || '[The author shared an image-only post.]' },
      { role: 'assistant', content: started.thread.content },
    ];
    let remaining = 12000;
    const retained = history
      .filter((turn) => {
        const length = turn.userContent.length + turn.replyContent.length;
        if (length > remaining) return false;
        remaining -= length;
        return true;
      })
      .reverse();
    for (const turn of retained)
      messages.push(
        { role: 'user', content: turn.userContent },
        { role: 'assistant', content: turn.replyContent }
      );
    messages.push({ role: 'user', content: started.turn.userContent });
    const response = await createChatCompletion(config.chat, messages, {
      requestTimeoutMs: 45000,
      temperature: 0.8,
    });
    const replyContent = response.content.trim();
    if (!replyContent) throw new HTTPException(502, { message: 'post_comment_generation_failed' });
    const result = await db.transaction(async (transaction) => {
      await lockDatabaseOwner(transaction, ownerId);
      const post = await ownedPost(kind, id, ownerId, transaction, true);
      if (postContentHash(post.content) !== started.turn.sourceHash)
        throw new HTTPException(409, { message: 'post_comment_source_changed' });
      const [saved] = await transaction
        .update(postReplyTurns)
        .set({ replyContent, status: 'completed' })
        .where(and(eq(postReplyTurns.id, started.turn.id), eq(postReplyTurns.status, 'running')))
        .returning();
      if (!saved) throw new HTTPException(409, { message: 'post_comment_cancelled' });
      return saved;
    });
    if (response.usage) {
      const { trackBackgroundTask } = await import('../utils/backgroundTask');
      trackBackgroundTask(
        logAiTokenUsage({
          userid: ownerId,
          model: config.chat.model,
          type: 'comment',
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }),
        'post_reply_usage_failed'
      );
    }
    return result;
  } catch (error) {
    await db
      .update(postReplyTurns)
      .set({ status: 'failed' })
      .where(and(eq(postReplyTurns.id, started.turn.id), eq(postReplyTurns.status, 'running')));
    if (error instanceof HTTPException) throw error;
    // eslint-disable-next-line no-console
    console.error('[post-replies] generation failed', error);
    throw new HTTPException(502, { message: 'post_comment_generation_failed' });
  }
}
