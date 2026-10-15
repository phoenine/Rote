import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { getAiAccessError } from '../../authz/aiAccess';
import type { User } from '../../drizzle/schema';
import { authenticateJWT, optionalJWT } from '../../middleware/jwtAuth';
import { continuePostReply, listPostReplies } from '../../postComments/conversations';
import { deletePostComment, generatePostComment } from '../../postComments/service';
import type { HonoContext, HonoVariables } from '../../types/hono';
import { createResponse } from '../../utils/main';

const router = new Hono<{ Variables: HonoVariables }>();
const target = z.object({ kind: z.enum(['rote', 'article']), id: z.uuid() });
function readTarget(c: HonoContext) {
  const parsed = target.safeParse(c.req.param());
  if (!parsed.success) throw new HTTPException(400, { message: 'post_comment_invalid_request' });
  return parsed.data;
}

router.get('/:kind/:id', optionalJWT, async (c) => {
  const { kind, id } = readTarget(c);
  return c.json(
    createResponse(await listPostReplies(kind, id, (c.get('user') as User | undefined)?.id))
  );
});
router.use('*', authenticateJWT);
router.post('/:kind/:id', async (c) => {
  const { kind, id } = readTarget(c);
  const user = c.get('user') as User;
  if (await getAiAccessError(user))
    throw new HTTPException(403, { message: 'post_comment_permission_required' });
  const body = z
    .object({
      requestId: z.uuid(),
      threadId: z.uuid().optional(),
      content: z.string().max(4000).optional(),
      retry: z.boolean().optional(),
    })
    .safeParse(await c.req.json());
  if (!body.success) throw new HTTPException(400, { message: 'post_comment_invalid_request' });
  const result = body.data.threadId
    ? await continuePostReply(
        kind,
        id,
        user.id,
        body.data.threadId,
        body.data.requestId,
        body.data.content || '',
        body.data.retry === true
      )
    : await generatePostComment(kind, id, user.id, body.data.requestId, { conversation: true });
  return c.json(createResponse(result));
});
router.delete('/:kind/:id/:threadId', async (c) => {
  const { kind, id } = readTarget(c);
  const threadId = z.uuid().safeParse(c.req.param('threadId'));
  if (!threadId.success) throw new HTTPException(400, { message: 'post_comment_invalid_request' });
  await deletePostComment(kind, id, (c.get('user') as User).id, threadId.data);
  return c.json(createResponse(null));
});

export default router;
