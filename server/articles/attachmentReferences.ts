import { and, eq, sql } from 'drizzle-orm';
import { articleAttachments, attachments } from '../drizzle/schema';
import type db from '../utils/drizzle';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Conservatively retain owned URLs, including Markdown reference definitions. */
export async function syncArticleAttachments(
  transaction: Transaction,
  article: { id: string; authorId: string; content: string }
) {
  const referenced = await transaction
    .select({ id: attachments.id })
    .from(attachments)
    .where(
      and(
        eq(attachments.userid, article.authorId),
        sql`(
          (${attachments.url} <> '' AND strpos(${article.content}, ${attachments.url}) > 0)
          OR (${attachments.compressUrl} <> '' AND strpos(${article.content}, ${attachments.compressUrl}) > 0)
        )`
      )
    );
  await transaction.delete(articleAttachments).where(eq(articleAttachments.articleId, article.id));
  if (referenced.length) {
    await transaction
      .insert(articleAttachments)
      .values(referenced.map(({ id }) => ({ articleId: article.id, attachmentId: id })));
  }
}

export function attachmentHasNoArticleReference() {
  return sql`NOT EXISTS (
    SELECT 1 FROM ${articleAttachments}
    WHERE ${articleAttachments.attachmentId} = ${attachments.id}
  )`;
}
