import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { personaMemories, personaMemoryJobs, personaMemorySuppressions } from '../drizzle/schema';
import db from '../utils/drizzle';
import { lockDatabaseOwner } from '../database/ownerLock';
import type { MemoryOperation } from './extraction';
import type { MemoryJob } from './repository';
import { readMemorySource } from './source';

export async function applyMemoryOperations(job: MemoryJob, operations: MemoryOperation[]) {
  await db.transaction(async (tx) => {
    await lockDatabaseOwner(tx, job.ownerId);
    const [claimed] = await tx
      .select()
      .from(personaMemoryJobs)
      .where(
        and(
          eq(personaMemoryJobs.id, job.id),
          eq(personaMemoryJobs.leaseToken, job.leaseToken!),
          eq(personaMemoryJobs.status, 'running')
        )
      )
      .for('update');
    if (!claimed) return;
    const source = await readMemorySource(job, tx, true);
    if (
      !source ||
      source.hash !== job.sourceHash ||
      (job.turnId && source.personaId !== job.personaId)
    ) {
      await tx
        .update(personaMemoryJobs)
        .set({ status: 'cancelled', leaseToken: null })
        .where(eq(personaMemoryJobs.id, job.id));
      return;
    }
    for (const op of operations) {
      const personaId = op.scope === 'shared' ? 'shared' : job.personaId;
      const scope = and(
        eq(personaMemories.ownerId, job.ownerId),
        eq(personaMemories.personaId, personaId)
      );
      if (op.action !== 'remember') {
        const forgotten = and(
          scope,
          lte(personaMemories.createdAt, job.createdAt),
          op.action === 'forget' ? eq(personaMemories.id, op.id) : undefined
        );
        const rows = await tx.select().from(personaMemories).where(forgotten);
        for (const memory of rows) {
          const sourceIds = [
            memory.roteId ? `rote:${memory.roteId}` : `article:${memory.articleId}`,
          ];
          await tx
            .insert(personaMemorySuppressions)
            .values({
              ownerId: job.ownerId,
              personaId,
              key: memory.key,
              forgottenBefore: job.createdAt,
              sourceIds,
            })
            .onConflictDoUpdate({
              target: [
                personaMemorySuppressions.ownerId,
                personaMemorySuppressions.personaId,
                personaMemorySuppressions.key,
              ],
              set: {
                forgottenBefore: sql`greatest(${personaMemorySuppressions.forgottenBefore}, excluded.forgotten_before)`,
                sourceIds: sql`(SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements(${personaMemorySuppressions.sourceIds} || excluded.source_ids))`,
              },
            });
        }
        if (op.action === 'forget_all')
          await tx
            .insert(personaMemorySuppressions)
            .values({ ownerId: job.ownerId, personaId, key: '*', forgottenBefore: job.createdAt })
            .onConflictDoUpdate({
              target: [
                personaMemorySuppressions.ownerId,
                personaMemorySuppressions.personaId,
                personaMemorySuppressions.key,
              ],
              set: {
                forgottenBefore: sql`greatest(${personaMemorySuppressions.forgottenBefore}, excluded.forgotten_before)`,
              },
            });
        await tx.delete(personaMemories).where(forgotten);
        continue;
      }
      let key = op.key.normalize('NFKC').trim().toLowerCase();
      if (op.replaces) {
        const [previous] = await tx
          .select()
          .from(personaMemories)
          .where(and(scope, eq(personaMemories.id, op.replaces)));
        if (!previous) throw new Error('Memory correction target is outside this scope');
        key = previous.key;
      }
      const suppressions = await tx
        .select()
        .from(personaMemorySuppressions)
        .where(
          and(
            eq(personaMemorySuppressions.ownerId, job.ownerId),
            eq(personaMemorySuppressions.personaId, personaId),
            inArray(personaMemorySuppressions.key, [key, '*'])
          )
        );
      if (
        suppressions.some(
          (item) =>
            item.forgottenBefore >= job.createdAt ||
            (item.key === key &&
              !/(记住|记下来|记得|remember|keep in mind|覚えて)/i.test(op.evidence))
        )
      )
        continue;
      await tx
        .delete(personaMemorySuppressions)
        .where(
          and(
            eq(personaMemorySuppressions.ownerId, job.ownerId),
            eq(personaMemorySuppressions.personaId, personaId),
            eq(personaMemorySuppressions.key, key)
          )
        );
      const [previous] = await tx
        .select()
        .from(personaMemories)
        .where(and(scope, eq(personaMemories.key, key)));
      // Use the author's source timestamp, not LLM completion order.
      if (previous && previous.createdAt > job.createdAt) continue;
      const values = {
        ownerId: job.ownerId,
        personaId,
        key,
        createdAt: job.createdAt,
        content: op.content,
        evidence: op.evidence,
        roteId: job.roteId,
        articleId: job.articleId,
        threadId: job.threadId,
        turnId: job.turnId,
        sourceHash: source.hash,
        publicSource: source.isPublic,
        expiresAt: op.ttlDays ? new Date(job.createdAt.getTime() + op.ttlDays * 86400000) : null,
        embedding: null,
        generationId: null,
        indexAttemptedAt: null,
        updatedAt: new Date(),
      };
      await tx
        .insert(personaMemories)
        .values(values)
        .onConflictDoUpdate({
          target: [personaMemories.ownerId, personaMemories.personaId, personaMemories.key],
          set: values,
        });
    }
    await tx
      .update(personaMemoryJobs)
      .set({ status: 'completed', leaseToken: null })
      .where(eq(personaMemoryJobs.id, job.id));
  });
}
