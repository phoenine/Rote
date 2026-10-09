import { and, eq, or, sql } from 'drizzle-orm';
import { personaMemories, personaMemoryJobs } from '../drizzle/schema';
import db from '../utils/drizzle';
import { getStoredAiConfig } from '../utils/dbMethods/ai/config';
import { getAiAccessError } from '../authz/aiAccess';
import { trackBackgroundTask } from '../utils/backgroundTask';
import { logAiTokenUsage } from '../utils/dbMethods/aiToken';
import { getPgvectorStatus } from '../utils/dbMethods/ai/vector';
import { readAiSnapshot } from '../embeddings/configStore';
import { createQueryEmbedding } from '../embeddings/query';
import { availableMemories, claimMemoryJob, currentMemory } from './repository';
import { applyMemoryOperations } from './mutations';
import { extractMemories } from './extraction';
import { readMemorySource } from './source';

export async function processMemoryJobs(limit = 5) {
  const config = await getStoredAiConfig();
  if (!config.enabled || !config.chat.baseUrl || !config.chat.model) return;
  for (let i = 0; i < limit; i++) {
    const job = await claimMemoryJob();
    if (!job) break;
    try {
      const source = await readMemorySource(job);
      if (
        !source ||
        source.hash !== job.sourceHash ||
        (await getAiAccessError({ id: job.ownerId }))
      ) {
        await applyMemoryOperations(job, []);
        continue;
      }
      const existing = (await availableMemories(job.ownerId, job.personaId))
        .filter((current) => !source.isPublic || current.isPublic)
        .map((current) => current.memory);
      const result = await extractMemories(
        config,
        source.text,
        job.personaId,
        existing.map(({ id, personaId, key, content }) => ({ id, personaId, key, content }))
      );
      await applyMemoryOperations(job, result.operations);
      if (result.usage)
        trackBackgroundTask(
          logAiTokenUsage({
            userid: job.ownerId,
            model: config.chat.model,
            type: 'comment',
            promptTokens: result.usage.prompt_tokens,
            completionTokens: result.usage.completion_tokens,
            totalTokens: result.usage.total_tokens,
          }),
          'persona_memory_usage_failed'
        );
    } catch (error) {
      await db
        .update(personaMemoryJobs)
        .set({ status: 'failed', leaseToken: null, errorCode: 'memory_extraction_failed' })
        .where(
          and(eq(personaMemoryJobs.id, job.id), eq(personaMemoryJobs.leaseToken, job.leaseToken!))
        );
      process.emitWarning(error instanceof Error ? error : new Error(String(error)), {
        code: 'persona_memory_extraction_failed',
      });
    }
  }
}

/** Re-index stored memories after provider/index-generation changes, without another LLM call. */
export async function indexPersonaMemories(limit = 5) {
  if (!(await getPgvectorStatus()).ready) return;
  const { config, state } = await readAiSnapshot();
  const rows = await db
    .select()
    .from(personaMemories)
    .where(
      or(
        sql`${personaMemories.embedding} IS NULL`,
        sql`${personaMemories.generationId} IS DISTINCT FROM ${state.generationId}`
      )
    )
    .orderBy(
      sql`${personaMemories.indexAttemptedAt} ASC NULLS FIRST`,
      personaMemories.updatedAt,
      personaMemories.id
    )
    .limit(limit);
  for (const row of rows) {
    try {
      // Rotate skipped or failed records behind memories that have not been tried.
      await db
        .update(personaMemories)
        .set({ indexAttemptedAt: new Date() })
        .where(and(eq(personaMemories.id, row.id), eq(personaMemories.updatedAt, row.updatedAt)));
      const current = await currentMemory(row.id, row.ownerId);
      if (!current) {
        await db
          .delete(personaMemories)
          .where(and(eq(personaMemories.id, row.id), eq(personaMemories.updatedAt, row.updatedAt)));
        continue;
      }
      if (await getAiAccessError({ id: row.ownerId })) continue;
      const result = await createQueryEmbedding(
        config,
        state.generationId!,
        state.dimensions!,
        row.content,
        { timeoutMs: 10000 }
      );
      await db
        .update(personaMemories)
        .set({ embedding: result.embedding, generationId: state.generationId })
        .where(and(eq(personaMemories.id, row.id), eq(personaMemories.updatedAt, row.updatedAt)));
      if (result.usage)
        trackBackgroundTask(
          logAiTokenUsage({
            userid: row.ownerId,
            model: config.embedding.model,
            type: 'embedding',
            promptTokens: result.usage.prompt_tokens,
            completionTokens: 0,
            totalTokens: result.usage.total_tokens,
          }),
          'persona_memory_usage_failed'
        );
    } catch (error) {
      process.emitWarning(error instanceof Error ? error : new Error(String(error)), {
        code: 'persona_memory_index_failed',
      });
    }
  }
}

let started = false;
let running = false;
export function startPersonaMemoryWorker() {
  if (started) return;
  started = true;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await db.delete(personaMemories).where(sql`${personaMemories.expiresAt} <= now()`);
      await processMemoryJobs();
      await indexPersonaMemories();
    } finally {
      running = false;
    }
  };
  const run = () => trackBackgroundTask(tick(), 'persona_memory_worker_failed');
  run();
  setInterval(run, 10000).unref();
}
