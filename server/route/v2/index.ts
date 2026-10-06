import { Hono } from 'hono';
import type { HonoContext, HonoVariables } from '../../types/hono';
import { createResponse } from '../../utils/main';
import billingRouter from '../../billing/public';
import noteSharesRouter from '../../noteShares/routes';
import adminRouter from './admin';
import adminPermissionsRouter from './adminPermissions';
import aiRouter from './ai';
import postCommentsRouter from './postComments';
import apiKeysRouter from './apikey';
import articlesRouter from './article';
import attachmentsRouter from './attachment';
import authRouter from './auth';
import changeRouter from './change';
import importsRouter from './imports';
import notesRouter from './note';
import notificationsRouter from './notification';
import oauthRouter from './oauth';
import mcpRouter from './mcp';
import mcpOAuthRouter from './mcpOAuth';
import openKeyAttachmentRouter from './openKeyAttachment';
import openKeyRouter from './openKeyRouter';
import passkeyRouter from './passkey';
import permissionsRouter from './permissions';
import pushRouter from './push';
import reactionsRouter from './reaction';
import resourcesRouter from './resources';
import siteRouter from './site';
import subscriptionsRouter from './subscription';
import usersRouter from './user';

const router = new Hono<{ Variables: HonoVariables }>();

// 健康检查
router.get('/health', (c: HonoContext) => c.json(createResponse(), 200));

// 注册子路由
router.route('/auth', authRouter);
router.route('/auth/oauth', oauthRouter);
router.route('/auth/passkey', passkeyRouter);
router.route('/users', usersRouter);
router.route('/', noteSharesRouter);
router.route('/notes', notesRouter);
router.route('/articles', articlesRouter);
router.route('/reactions', reactionsRouter);
router.route('/notifications', notificationsRouter);
router.route('/subscriptions', subscriptionsRouter);
router.route('/api-keys', apiKeysRouter);
router.route('/attachments', attachmentsRouter);
router.route('/site', siteRouter);
router.route('/openkey', openKeyAttachmentRouter);
router.route('/openkey', openKeyRouter);
router.route('/oauth', mcpOAuthRouter);
router.route('/mcp', mcpRouter);
router.route('/admin', adminRouter);
router.route('/admin/permissions', adminPermissionsRouter);
router.route('/permissions', permissionsRouter);
router.route('/push', pushRouter);
router.route('/ai', aiRouter);
router.route('/post-comments', postCommentsRouter);
router.route('/changes', changeRouter);
router.route('/imports', importsRouter);
router.route('/billing', billingRouter);
router.route('/resources', resourcesRouter);

export default router;
