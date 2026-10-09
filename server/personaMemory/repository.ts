import { and, eq, inArray, sql } from 'drizzle-orm';
import { articles, rotes, personaMemories, personaMemoryJobs } from '../drizzle/schema';
import db from '../utils/drizzle';
import { postContentHash, type PostKind } from '../postComments/content';
import { lockDatabaseOwner } from '../database/ownerLock';
import { readMemorySource, type MemorySource } from './source';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type MemoryJob = typeof personaMemoryJobs.$inferSelect;

/** Enqueued in the reply-save transaction: durable and idempotent across restarts. */
export async function enqueuePersonaMemory(
  tx: Transaction,
  kind: PostKind,
  id: string,
  ownerId: string,
  text: string,
  turn?: { id: string; threadId: string; personaId: string; createdAt: Date }
) {
  const hash = postContentHash(text);
  const table = kind === 'rote' ? rotes : articles;
  const [post] = await tx
    .select({ updatedAt: table.updatedAt })
    .from(table)
    .where(eq(table.id, id));
  await tx
    .insert(personaMemoryJobs)
    .values({
      ownerId,
      createdAt: turn?.createdAt || post.updatedAt,
      roteId: kind === 'rote' ? id : null,
      articleId: kind === 'article' ? id : null,
      threadId: turn?.threadId,
      turnId: turn?.id,
      personaId: turn?.personaId || 'shared',
      sourceHash: hash,
      dedupeKey: turn ? `turn:${turn.id}` : `post:${kind}:${id}:${hash}`,
    })
    .onConflictDoNothing();
}

export async function claimMemoryJob() {
  // Model calls have a 30-second limit; a crashed process can release its lease after two minutes.
  await db
    .update(personaMemoryJobs)
    .set({ status: 'failed', leaseToken: null, errorCode: 'memory_job_interrupted' })
    .where(
      and(
        eq(personaMemoryJobs.status, 'running'),
        sql`${personaMemoryJobs.startedAt} < now() - interval '2 minutes'`
      )
    );
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ ownerId: personaMemoryJobs.ownerId })
      .from(personaMemoryJobs)
      .where(
        and(
          eq(personaMemoryJobs.status, 'pending'),
          sql`NOT EXISTS (SELECT 1 FROM persona_memory_jobs active WHERE active.owner_id = ${personaMemoryJobs.ownerId} AND active.status = 'running')`
        )
      )
      .orderBy(personaMemoryJobs.createdAt, personaMemoryJobs.id)
      .limit(1);
    if (!candidate) return null;
    await lockDatabaseOwner(tx, candidate.ownerId);
    const [next] = await tx
      .select()
      .from(personaMemoryJobs)
      .where(
        and(
          eq(personaMemoryJobs.ownerId, candidate.ownerId),
          eq(personaMemoryJobs.status, 'pending')
        )
      )
      .orderBy(personaMemoryJobs.createdAt, personaMemoryJobs.id)
      .limit(1)
      .for('update', { skipLocked: true });
    if (!next) return null;
    const [running] = await tx
      .select({ id: personaMemoryJobs.id })
      .from(personaMemoryJobs)
      .where(
        and(eq(personaMemoryJobs.ownerId, next.ownerId), eq(personaMemoryJobs.status, 'running'))
      );
    if (running) return null;
    const [job] = await tx
      .update(personaMemoryJobs)
      .set({ status: 'running', leaseToken: crypto.randomUUID(), startedAt: new Date() })
      .where(eq(personaMemoryJobs.id, next.id))
      .returning();
    return job;
  });
}

export async function currentMemory(
  id: string,
  ownerId: string,
  executor: Pick<typeof db, 'select'> = db,
  lock = false
) {
  const query = executor
    .select()
    .from(personaMemories)
    .where(and(eq(personaMemories.id, id), eq(personaMemories.ownerId, ownerId)));
  const [memory] = await (lock ? query.for('share') : query);
  if (!memory || (memory.expiresAt && memory.expiresAt <= new Date())) return null;
  const source = await readMemorySource(memory, executor, lock);
  if (!source || source.hash !== memory.sourceHash) return null;
  return { memory, isPublic: memory.publicSource && source.isPublic };
}

export async function availableMemories(ownerId: string, personaId: string) {
  const rows = await db
    .select()
    .from(personaMemories)
    .where(
      and(
        eq(personaMemories.ownerId, ownerId),
        inArray(personaMemories.personaId, ['shared', personaId])
      )
    )
    .orderBy(sql`${personaMemories.updatedAt} DESC`)
    .limit(100);
  const valid = [];
  for (const row of rows) {
    const current = await currentMemory(row.id, ownerId);
    if (current) valid.push(current.memory);
  }
  return valid;
}

export function memoryVersion(memory: typeof personaMemories.$inferSelect) {
  return postContentHash(
    JSON.stringify([
      memory.content,
      memory.personaId,
      memory.sourceHash,
      memory.publicSource,
      memory.updatedAt.toISOString(),
    ])
  );
}
export type { MemorySource };
