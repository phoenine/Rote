import { del, get, post } from '@/utils/api';

export type PostKind = 'rote' | 'article';
export type PostComment = {
  id: string;
  content: string;
  status: 'running' | 'completed' | 'failed';
  model: string;
  createdAt: string;
  stale: boolean;
};

function commentPath(kind: PostKind, id: string) {
  return `/post-comments/${kind}/${id}`;
}

export async function listPostComments(kind: PostKind, id: string): Promise<PostComment[]> {
  return (await get(commentPath(kind, id))).data;
}

export async function generatePostComment(
  kind: PostKind,
  id: string,
  requestId: string
): Promise<PostComment> {
  return (await post(commentPath(kind, id), { requestId })).data;
}

export async function deletePostComment(kind: PostKind, id: string, commentId: string) {
  await del(`${commentPath(kind, id)}/${commentId}`);
}

export function postCommentErrorKey(error: unknown): string {
  const code = (error as { response?: { data?: { error?: string; message?: string } } })?.response
    ?.data;
  const message = code?.message || code?.error;
  const known = new Set([
    'post_comment_text_required',
    'post_comment_content_too_long',
    'post_comment_running',
    'post_comment_ai_unavailable',
    'post_comment_source_changed',
    'post_comment_cancelled',
    'post_comment_permission_required',
  ]);
  return message && known.has(message) ? `errors.${message}` : 'errors.failed';
}
