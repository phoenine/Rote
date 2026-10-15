import { eq, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { personaMemorySuppressions } from '../drizzle/schema';
import db from '../utils/drizzle';
import { vectorToLiteral } from '../utils/ai/client';
import type { MemoryCandidate } from '../postComments/memoryContext';
import { currentMemory, memoryVersion } from './repository';
import { readMemorySource, type MemoryExecutor } from './source';
import { personas } from '../postComments/personas';

export async function retrievePersonaCandidates(
  ownerId: string,
  vector: number[],
  generationId: string,
  target: { roteId: string | null; articleId: string | null }
) {
  const destination = await readMemorySource({ ownerId, ...target, turnId: null, threadId: null });
  if (!destination) return [];
  const candidates: MemoryCandidate[] = [];
  // Small owner-scoped memory collections use pgvector distance without a global dimension-specific index.
  for (const personaId of ['shared', ...Object.keys(personas)]) {
    const rows = await db.execute(sql`SELECT id FROM persona_memories
      WHERE owner_id = ${ownerId} AND persona_id = ${personaId}
        AND generation_id = ${generationId} AND embedding IS NOT NULL
        AND (expires_at IS NULL OR expires_at > now())
        AND (NOT ${destination.isPublic} OR public_source = true)
      ORDER BY embedding::text::vector(${sql.raw(String(vector.length))}) <=> ${vectorToLiteral(vector)}::vector
      LIMIT 6`);
    let accepted = 0;
    for (const row of rows) {
      const current = await currentMemory(String(row.id), ownerId);
      if (!current || (destination.isPublic && !current.isPublic)) continue;
      candidates.push({
        kind: 'memory',
        id: current.memory.id,
        hash: memoryVersion(current.memory),
        text: current.memory.content,
        date: current.memory.updatedAt.toISOString().slice(0, 10),
        personaId,
      });
      if (++accepted >= 2) break;
    }
  }
  return candidates;
}

export async function assertPersonaMemoryCurrent(
  id: string,
  hash: string,
  ownerId: string,
  publicReply: boolean,
  executor: MemoryExecutor
) {
  const current = await currentMemory(id, ownerId, executor, true);
  if (!current || memoryVersion(current.memory) !== hash || (publicReply && !current.isPublic))
    throw new HTTPException(409, { message: 'post_comment_source_changed' });
}

export async function memorySuppressions(ownerId: string) {
  return db
    .select({
      personaId: personaMemorySuppressions.personaId,
      sourceIds: personaMemorySuppressions.sourceIds,
    })
    .from(personaMemorySuppressions)
    .where(eq(personaMemorySuppressions.ownerId, ownerId));
}
