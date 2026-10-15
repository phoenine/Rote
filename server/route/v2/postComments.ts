import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { User } from '../../drizzle/schema';
import { z } from 'zod';
import { getAiAccessError } from '../../authz/aiAccess';
import { authenticateJWT } from '../../middleware/jwtAuth';
import {
  deletePostComment,
  expirePostComments,
  generatePostComment,
  listPostComments,
} from '../../postComments/service';
import { type PostKind } from '../../postComments/content';
import type { HonoContext, HonoVariables } from '../../types/hono';
import { bodyTypeCheck, createResponse } from '../../utils/main';

const router = new Hono<{ Variables: HonoVariables }>();
const target = z.object({ kind: z.enum(['rote', 'article']), id: z.uuid() });

function readTarget(c: HonoContext): { kind: PostKind; id: string } {
  const parsed = target.safeParse(c.req.param());
  if (!parsed.success) throw new HTTPException(400, { message: 'post_comment_invalid_request' });
  return parsed.data;
}

router.use('*', authenticateJWT);
router.get('/:kind/:id', async (c) => {
  const { kind, id } = readTarget(c);
  const user = c.get('user') as User;
  // Verify ownership before mutating abandoned requests.
  await listPostComments(kind, id, user.id);
  await expirePostComments(kind, id, user.id);
  return c.json(createResponse(await listPostComments(kind, id, user.id)));
});
router.post('/:kind/:id', bodyTypeCheck, async (c) => {
  const { kind, id } = readTarget(c);
  const user = c.get('user') as User;
  const accessError = await getAiAccessError(user);
  if (accessError) throw new HTTPException(403, { message: 'post_comment_permission_required' });
  const body = z.object({ requestId: z.uuid() }).safeParse(await c.req.json());
  if (!body.success) throw new HTTPException(400, { message: 'post_comment_invalid_request' });
  return c.json(createResponse(await generatePostComment(kind, id, user.id, body.data.requestId)));
});
router.delete('/:kind/:id/:commentId', async (c) => {
  const { kind, id } = readTarget(c);
  const commentId = z.uuid().safeParse(c.req.param('commentId'));
  if (!commentId.success) throw new HTTPException(400, { message: 'post_comment_invalid_request' });
  await deletePostComment(kind, id, (c.get('user') as User).id, commentId.data);
  return c.json(createResponse(null));
});

export default router;
