import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import {
  articleAttachments,
  articles,
  attachments,
  roteChanges,
  rotes,
  users,
} from '../drizzle/schema';

// Never run destructive integration fixtures against a normal deployment.
const url = process.env.ROTE_PRODUCT_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith('_product_test')) {
  throw new Error('ROTE_PRODUCT_TEST_DATABASE_URL must name a dedicated _product_test database');
}

describe.skipIf(!url)('article attachment lifecycle in PostgreSQL', () => {
  let database: typeof import('../utils/drizzle').db;
  let sync: typeof import('./attachmentReferences').syncArticleAttachments;
  let lock: typeof import('../database/ownerLock').lockDatabaseOwner;
  let noReference: typeof import('./attachmentReferences').attachmentHasNoArticleReference;
  const ownerId = crypto.randomUUID();
  const otherOwnerId = crypto.randomUUID();
  const attachmentId = crypto.randomUUID();
  const otherAttachmentId = crypto.randomUUID();
  const image = `https://fixture.invalid/${attachmentId}.png`;
  const compressed = `https://fixture.invalid/${attachmentId}.webp`;
  const articleId = crypto.randomUUID();
  const secondArticleId = crypto.randomUUID();
  const noteId = crypto.randomUUID();

  beforeAll(async () => {
    process.env.POSTGRESQL_URL = url;
    process.env.POSTGRESQL_MIGRATION_URL = url;
    const runtime = await import('../utils/drizzle');
    await runtime.runMigrations();
    database = runtime.db;
    ({ syncArticleAttachments: sync, attachmentHasNoArticleReference: noReference } =
      await import('./attachmentReferences'));
    ({ lockDatabaseOwner: lock } = await import('../database/ownerLock'));
    await database
      .insert(users)
      .values(
        [ownerId, otherOwnerId].map((id) => ({ id, email: `${id}@fixture.invalid`, username: id }))
      );
    await database.insert(attachments).values([
      {
        id: attachmentId,
        userid: ownerId,
        url: image,
        compressUrl: compressed,
        storage: 'test',
        details: {},
      },
      {
        id: otherAttachmentId,
        userid: otherOwnerId,
        url: `https://fixture.invalid/${otherAttachmentId}.png`,
        storage: 'test',
        details: {},
      },
    ]);
  });

  afterAll(async () => {
    if (!database) return;
    await database.delete(articles).where(eq(articles.authorId, ownerId));
    await database.delete(attachments).where(eq(attachments.id, attachmentId));
    await database.delete(attachments).where(eq(attachments.id, otherAttachmentId));
    await database.delete(roteChanges).where(eq(roteChanges.userid, ownerId));
    await database.delete(rotes).where(eq(rotes.id, noteId));
    await database.delete(users).where(eq(users.id, ownerId));
    await database.delete(users).where(eq(users.id, otherOwnerId));
    await (await import('../utils/drizzle')).closeDatabase();
  });

  it('retains inline and reference images, excluding other owners', async () => {
    await database.transaction(async (transaction) => {
      await lock(transaction, ownerId);
      const [article] = await transaction
        .insert(articles)
        .values({
          id: articleId,
          authorId: ownerId,
          content: `![image][ref]\n[ref]: ${compressed}\n![foreign](https://fixture.invalid/${otherAttachmentId}.png)`,
        })
        .returning();
      await sync(transaction, article);
    });
    const links = await database
      .select()
      .from(articleAttachments)
      .where(eq(articleAttachments.articleId, articleId));
    expect(links.map((link) => link.attachmentId)).toEqual([attachmentId]);
    const candidates = await database
      .select({ id: attachments.id })
      .from(attachments)
      .where(sql`${attachments.id} = ${attachmentId} AND ${noReference()}`);
    expect(candidates).toHaveLength(0);
    await expect(
      database.delete(attachments).where(eq(attachments.id, attachmentId)).execute()
    ).rejects.toThrow();
  });

  it('detaches article-shared note images and records incremental changes', async () => {
    await database.insert(rotes).values({ id: noteId, authorid: ownerId, content: 'Shared image' });
    const { deleteAttachment, deleteAttachments } = await import('../utils/dbMethods/attachment');
    for (const remove of [
      () => deleteAttachment(attachmentId, ownerId),
      () => deleteAttachments([{ id: attachmentId }], ownerId),
    ]) {
      await database
        .update(attachments)
        .set({ roteid: noteId })
        .where(eq(attachments.id, attachmentId));
      await remove();
      const [imageRecord] = await database
        .select()
        .from(attachments)
        .where(eq(attachments.id, attachmentId));
      expect(imageRecord.roteid).toBeNull();
      expect(
        await database
          .select()
          .from(articleAttachments)
          .where(eq(articleAttachments.attachmentId, attachmentId))
      ).toHaveLength(1);
    }
    expect(
      await database.select().from(roteChanges).where(eq(roteChanges.roteid, noteId))
    ).toHaveLength(2);
  });

  it('retains shared images until the last article reference is removed', async () => {
    await database.transaction(async (transaction) => {
      await lock(transaction, ownerId);
      const [second] = await transaction
        .insert(articles)
        .values({ id: secondArticleId, authorId: ownerId, content: `![image](${image})` })
        .returning();
      await sync(transaction, second);
      const [first] = await transaction
        .update(articles)
        .set({ content: 'No image now' })
        .where(eq(articles.id, articleId))
        .returning();
      await sync(transaction, first);
    });
    expect(
      await database
        .select()
        .from(articleAttachments)
        .where(eq(articleAttachments.attachmentId, attachmentId))
    ).toHaveLength(1);
    await database.delete(articles).where(eq(articles.id, secondArticleId));
    expect(
      await database
        .select({ id: attachments.id })
        .from(attachments)
        .where(sql`${attachments.id} = ${attachmentId} AND ${noReference()}`)
    ).toHaveLength(1);
  });
});
