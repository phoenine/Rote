import {
  retrievePersonaCandidates,
  assertPersonaMemoryCurrent,
  memorySuppressions,
} from '../personaMemory/retrieval';
import { readMemorySource } from '../personaMemory/source';
import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { articles, rotes } from '../drizzle/schema';
import { getPgvectorStatus } from '../utils/dbMethods/ai/vector';
import { getStoredAiConfig } from '../utils/dbMethods/ai/config';
import { semanticSearch } from '../utils/dbMethods/ai/semanticSearch';
import { buildSourceDocument } from '../utils/dbMethods/ai/documents';
import db from '../utils/drizzle';
import { postContentHash, type PostKind } from './content';
import { packReplyMemory, truncateUtf8, type ReplyMemory } from './memoryContext';

export type { ReplyMemory } from './memoryContext';
type Executor = Pick<typeof db, 'select'>;

async function publicSource(
  kind: PostKind,
  id: string,
  ownerId: string,
  executor: Executor = db,
  lock = false
) {
  if (kind === 'rote') {
    const query = executor
      .select()
      .from(rotes)
      .where(
        and(
          eq(rotes.id, id),
          eq(rotes.authorid, ownerId),
          eq(rotes.state, 'public'),
          eq(rotes.archived, false)
        )
      );
    const [source] = await (lock ? query.for('share') : query);
    return source;
  }
  const query = executor
    .select({ article: articles })
    .from(articles)
    .innerJoin(
      rotes,
      and(
        eq(rotes.articleId, articles.id),
        eq(rotes.authorid, ownerId),
        eq(rotes.state, 'public'),
        eq(rotes.archived, false)
      )
    )
    .where(and(eq(articles.id, id), eq(articles.authorId, ownerId)));
  const [source] = await (lock ? query.for('share') : query);
  return source?.article;
}

async function excludedTargets(kind: PostKind, id: string, ownerId: string) {
  const ids = [`${kind}:${id}`];
  if (kind === 'rote') {
    const [note] = await db
      .select({ articleId: rotes.articleId })
      .from(rotes)
      .where(and(eq(rotes.id, id), eq(rotes.authorid, ownerId)));
    if (note?.articleId) ids.push(`article:${note.articleId}`);
  } else {
    const notes = await db
      .select({ id: rotes.id })
      .from(rotes)
      .where(and(eq(rotes.articleId, id), eq(rotes.authorid, ownerId)));
    ids.push(...notes.map((note) => `rote:${note.id}`));
  }
  return ids;
}

/** Optional memory may be unavailable; report the failure and continue normal replies. */
export async function retrieveReplyMemory(
  kind: PostKind,
  id: string,
  ownerId: string,
  source: string,
  latest = ''
): Promise<ReplyMemory> {
  try {
    const config = await getStoredAiConfig();
    if (!config.enabled || !config.vectorEnabled || !(await getPgvectorStatus()).ready)
      return packReplyMemory([]);
    const query = truncateUtf8(
      [latest, source]
        .filter(Boolean)
        .join('\n')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .trim(),
      600
    );
    if (!query) return packReplyMemory([]);
    let queryEmbedding: { vector: number[]; generationId: string } | undefined;
    const results = await semanticSearch({
      query,
      onQueryEmbedding: (vector, generationId) => {
        queryEmbedding = { vector, generationId };
      },
      ownerId,
      viewerId: ownerId,
      publicSourcesOnly: true,
      excludeIds: await excludedTargets(kind, id, ownerId),
      limit: 3,
      embeddingTimeoutMs: 10000,
    });
    const candidates = [];
    for (const result of results) {
      const kind = result.sourceType;
      const current = await publicSource(kind, result.sourceId, ownerId);
      // Stale indexed text must not reveal content removed from the live public document.
      if (!current || !buildSourceDocument(kind, current).text.includes(result.text)) continue;
      candidates.push({
        kind,
        id: result.sourceId,
        hash: postContentHash(buildSourceDocument(kind, current).text),
        text: result.text,
        date: current.createdAt.toISOString().slice(0, 10),
      });
    }
    const target = {
      roteId: kind === 'rote' ? id : null,
      articleId: kind === 'article' ? id : null,
    };
    const destination = await readMemorySource({
      ownerId,
      ...target,
      threadId: null,
      turnId: null,
    });
    const learned = queryEmbedding
      ? await retrievePersonaCandidates(
          ownerId,
          queryEmbedding.vector,
          queryEmbedding.generationId,
          target
        )
      : [];
    return {
      ...packReplyMemory(candidates),
      candidates: [...learned, ...candidates],
      suppressions: await memorySuppressions(ownerId),
      publicReply: destination?.isPublic !== false,
    };
  } catch (error) {
    process.emitWarning(error instanceof Error ? error : new Error(String(error)), {
      code: 'post_reply_memory_unavailable',
    });
    return packReplyMemory([]);
  }
}

/** Recheck public visibility and version under the owner's save transaction. */
export async function assertReplyMemoryCurrent(
  memory: ReplyMemory,
  ownerId: string,
  executor: Executor,
  target?: { kind: PostKind; id: string }
) {
  const destination = target
    ? await readMemorySource(
        {
          ownerId,
          roteId: target.kind === 'rote' ? target.id : null,
          articleId: target.kind === 'article' ? target.id : null,
          threadId: null,
          turnId: null,
        },
        executor,
        true
      )
    : null;
  const publicReply = destination ? destination.isPublic : memory.publicReply !== false;
  for (const reference of memory.sources) {
    if (reference.kind === 'memory') {
      await assertPersonaMemoryCurrent(
        reference.id,
        reference.hash,
        ownerId,
        publicReply,
        executor
      );
      continue;
    }
    const current = await publicSource(reference.kind, reference.id, ownerId, executor, true);
    if (
      !current ||
      postContentHash(buildSourceDocument(reference.kind, current).text) !== reference.hash
    )
      throw new HTTPException(409, { message: 'post_comment_source_changed' });
  }
}
