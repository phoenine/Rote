import { and, eq } from 'drizzle-orm';
import { postAiComments } from '../drizzle/schema';
import db from '../utils/drizzle';
import { getAiAccessError } from '../authz/aiAccess';
import { getStoredAiConfig } from '../utils/dbMethods/ai/config';
import { trackBackgroundTask } from '../utils/backgroundTask';
import { retrieveReplyMemory, type ReplyMemory } from './memory';
import type { PostKind } from './content';
import { generatePostComment, targetFilter } from './service';
import { randomInt } from 'crypto';

export async function createAutomaticReply(kind: PostKind, id: string, ownerId: string) {
  const config = await getStoredAiConfig();
  if (
    !config.enabled ||
    !config.chat.baseUrl ||
    !config.chat.model ||
    (await getAiAccessError({ id: ownerId }))
  )
    return;
  const [existing] = await db
    .select({ id: postAiComments.id })
    .from(postAiComments)
    .where(and(targetFilter(kind, id, ownerId), eq(postAiComments.automatic, true)))
    .limit(1);
  if (existing) return;
  const count = randomInt(1, 4);
  let sharedMemory: Promise<ReplyMemory> | undefined;
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      generatePostComment(kind, id, ownerId, crypto.randomUUID(), {
        conversation: true,
        memory: (source) => (sharedMemory ??= retrieveReplyMemory(kind, id, ownerId, source)),
        automatic: true,
        automaticSlot: index + 1,
      })
    )
  );
}

export function scheduleAutomaticReply(kind: PostKind, id: string, ownerId: string) {
  trackBackgroundTask(createAutomaticReply(kind, id, ownerId), 'automatic_post_reply_failed');
}
