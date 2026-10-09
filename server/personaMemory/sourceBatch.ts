import { and, eq, inArray } from 'drizzle-orm';
import { articles, postAiComments, postReplyTurns, rotes } from '../drizzle/schema';
import db from '../utils/drizzle';
import { postContentHash } from '../postComments/content';
import type { MemorySource } from './source';

/** Load one owner's live source versions in at most four queries. */
export async function readMemorySources(ownerId: string, sources: MemorySource[]) {
  const noteIds = [...new Set(sources.flatMap((source) => (source.roteId ? [source.roteId] : [])))];
  const articleIds = [
    ...new Set(sources.flatMap((source) => (source.articleId ? [source.articleId] : []))),
  ];
  const turnIds = [...new Set(sources.flatMap((source) => (source.turnId ? [source.turnId] : [])))];
  const [notes, documents, publications, turns] = await Promise.all([
    noteIds.length
      ? db
          .select()
          .from(rotes)
          .where(and(eq(rotes.authorid, ownerId), inArray(rotes.id, noteIds)))
      : [],
    articleIds.length
      ? db
          .select()
          .from(articles)
          .where(and(eq(articles.authorId, ownerId), inArray(articles.id, articleIds)))
      : [],
    articleIds.length
      ? db
          .select({ articleId: rotes.articleId })
          .from(rotes)
          .where(
            and(
              eq(rotes.authorid, ownerId),
              inArray(rotes.articleId, articleIds),
              eq(rotes.state, 'public'),
              eq(rotes.archived, false)
            )
          )
      : [],
    turnIds.length
      ? db
          .select({ turn: postReplyTurns, thread: postAiComments })
          .from(postReplyTurns)
          .innerJoin(postAiComments, eq(postAiComments.id, postReplyTurns.threadId))
          .where(and(eq(postAiComments.ownerId, ownerId), inArray(postReplyTurns.id, turnIds)))
      : [],
  ]);
  const noteById = new Map(notes.map((note) => [note.id, note]));
  const articleById = new Map(documents.map((article) => [article.id, article]));
  const published = new Set(publications.map((note) => note.articleId));
  const turnById = new Map(turns.map((row) => [row.turn.id, row]));
  return sources.map((source) => {
    if (source.ownerId !== ownerId) return null;
    const post = source.roteId ? noteById.get(source.roteId) : articleById.get(source.articleId!);
    if (!post) return null;
    const isPublic =
      'state' in post ? post.state === 'public' && !post.archived : published.has(post.id);
    if (!source.turnId) return { hash: postContentHash(post.content), isPublic };
    const row = turnById.get(source.turnId);
    if (
      !row ||
      row.turn.status !== 'completed' ||
      row.thread.id !== source.threadId ||
      row.thread.roteId !== source.roteId ||
      row.thread.articleId !== source.articleId
    )
      return null;
    return {
      hash: postContentHash(row.turn.userContent),
      isPublic: isPublic && row.thread.publicSafe && row.turn.publicSafe,
    };
  });
}
