import { del, get, post } from '@/utils/api';

export type PostKind = 'rote' | 'article';
export type PostReplyTurn = {
  id: string;
  userContent: string;
  replyContent: string;
  status: 'running' | 'completed' | 'failed';
  requestId?: string;
  publicSafe?: boolean;
  stale: boolean;
};

export type PostComment = {
  id: string;
  content: string;
  status: 'running' | 'completed' | 'failed';
  personaId: string | null;
  legacy: boolean;
  publicSafe?: boolean;
  turns: PostReplyTurn[];
  createdAt: string;
  stale: boolean;
};

function commentPath(kind: PostKind, id: string) {
  return `/post-replies/${kind}/${id}`;
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
    'post_reply_role_limit',
    'post_reply_invalid_content',
    'post_reply_thread_unavailable',
  ]);
  return message && known.has(message) ? `errors.${message}` : 'errors.failed';
}

export async function replyToThread(
  kind: PostKind,
  id: string,
  threadId: string,
  content: string,
  requestId: string,
  retry = false
): Promise<PostReplyTurn> {
  return (await post(commentPath(kind, id), { threadId, content, requestId, retry })).data;
}
