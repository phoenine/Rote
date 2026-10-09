import { and, eq } from 'drizzle-orm';
import { articles, postAiComments, postReplyTurns, rotes } from '../drizzle/schema';
import db from '../utils/drizzle';
import { postContentHash, type PostKind } from '../postComments/content';

export type MemorySource = {
  ownerId: string;
  roteId: string | null;
  articleId: string | null;
  threadId: string | null;
  turnId: string | null;
};
export type MemoryExecutor = Pick<typeof db, 'select'>;

/** Read live author text only; neither AI messages nor inferred facts are source evidence. */
export async function readMemorySource(
  source: MemorySource,
  executor: MemoryExecutor = db,
  lock = false
) {
  const kind: PostKind = source.roteId ? 'rote' : 'article';
  const table = kind === 'rote' ? rotes : articles;
  const author = kind === 'rote' ? rotes.authorid : articles.authorId;
  const query = executor
    .select()
    .from(table)
    .where(and(eq(table.id, source.roteId || source.articleId!), eq(author, source.ownerId)));
  const [post] = await (lock ? query.for('share') : query);
  if (!post) return null;
  let isPublic = false;
  if ('state' in post) isPublic = post.state === 'public' && !post.archived;
  else {
    const publication = executor
      .select({ id: rotes.id })
      .from(rotes)
      .where(
        and(
          eq(rotes.articleId, post.id),
          eq(rotes.authorid, source.ownerId),
          eq(rotes.state, 'public'),
          eq(rotes.archived, false)
        )
      );
    const rows = await (lock ? publication.for('share') : publication);
    isPublic = rows.length > 0;
  }
  if (source.turnId) {
    if (!source.threadId) return null;
    const query = executor
      .select({ turn: postReplyTurns, thread: postAiComments })
      .from(postReplyTurns)
      .innerJoin(postAiComments, eq(postAiComments.id, postReplyTurns.threadId))
      .where(
        and(
          eq(postReplyTurns.id, source.turnId),
          eq(postAiComments.id, source.threadId),
          eq(postAiComments.ownerId, source.ownerId)
        )
      );
    const [row] = await (lock ? query.for('share') : query);
    if (
      !row ||
      row.turn.status !== 'completed' ||
      row.thread.roteId !== source.roteId ||
      row.thread.articleId !== source.articleId
    )
      return null;
    return {
      text: row.turn.userContent,
      hash: postContentHash(row.turn.userContent),
      isPublic,
      personaId: row.thread.personaId,
    };
  }
  return { text: post.content, hash: postContentHash(post.content), isPublic, personaId: 'shared' };
}
