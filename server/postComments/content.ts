import { createHash } from 'crypto';
import { HTTPException } from 'hono/http-exception';

export type PostKind = 'rote' | 'article';

export function postContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function requireCommentableText(content: string): void {
  const text = content.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
  if (!text) throw new HTTPException(422, { message: 'post_comment_text_required' });
  if (content.length > 20000) {
    throw new HTTPException(422, { message: 'post_comment_content_too_long' });
  }
}

export function commentMatchesTarget(
  comment: { roteId: string | null; articleId: string | null },
  kind: PostKind,
  id: string
) {
  return kind === 'rote' ? comment.roteId === id : comment.articleId === id;
}
