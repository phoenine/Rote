import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { usePermissions } from '@/hooks/usePermissions';
import { profileAtom } from '@/state/profile';
import { useAPIGet } from '@/utils/fetcher';
import {
  deletePostComment,
  generatePostComment,
  listPostComments,
  postCommentErrorKey,
  replyToThread,
  type PostComment,
  type PostReplyTurn,
  type PostKind,
} from './api';
import { ReplyThread } from './ReplyThread';
import { ReplyComposer } from './ReplyComposer';

export function PostComments({
  kind,
  id,
  owner,
  author,
}: {
  kind: PostKind;
  id: string;
  owner: boolean;
  author?: { name: string; avatar?: string | null };
}) {
  const { t } = useTranslation('translation', { keyPrefix: 'components.postComments' });
  const profile = useAtomValue(profileAtom);
  const { capabilities } = usePermissions();
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const identity = useRef<{ content: string; threadId: string; id: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [openedAt] = useState(Date.now);
  const { data, error, isLoading, mutate } = useAPIGet(
    { key: 'post-replies', kind, id, viewer: profile?.id || 'anonymous' },
    () => listPostComments(kind, id),
    {
      revalidateOnFocus: true,
      refreshInterval: (threads) =>
        owner &&
        (threads?.some(
          (thread) =>
            thread.status === 'running' || thread.turns?.some((turn) => turn.status === 'running')
        ) ||
          (!threads?.length && Date.now() - openedAt < 180000))
          ? 4000
          : 0,
    }
  );
  const canReply = owner && capabilities?.['ai.chat']?.allowed === true;
  const aiRoleCount = data?.filter((thread) => !thread.legacy && thread.personaId).length || 0;

  const readyThreads =
    data?.filter((thread) => !thread.legacy && thread.personaId && thread.status === 'completed') ||
    [];
  const target = readyThreads.find((thread) => thread.id === selectedId) || readyThreads[0];
  const targetName = target?.personaId ? t(`personas.${target.personaId}`) : undefined;
  const targetRunning = target?.turns?.some((turn) => turn.status === 'running');
  const commentAuthor = author || {
    name: owner ? profile?.nickname || t('author') : t('author'),
    avatar: owner ? profile?.avatar : undefined,
  };

  function selectThread(threadId: string) {
    setSelectedId(threadId);
    setExpandedIds((previous) => new Set(previous).add(threadId));
  }
  function toggleThread(threadId: string) {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }

  async function send(thread: PostComment, turn?: PostReplyTurn) {
    const value = turn?.userContent || content.trim();
    if (!value || sending) return;
    if (!turn && (identity.current?.content !== value || identity.current?.threadId !== thread.id))
      identity.current = { content: value, threadId: thread.id, id: crypto.randomUUID() };
    const requestId = turn?.requestId || identity.current!.id;
    selectThread(thread.id);
    setSending(true);
    try {
      const result = await replyToThread(kind, id, thread.id, value, requestId, true);
      if (result.status === 'completed') {
        if (!turn || content.trim() === turn.userContent) {
          setContent('');
          identity.current = null;
        }
      } else if (result.status === 'failed') toast.error(t('errors.failed'));
    } catch (requestError) {
      toast.error(t(postCommentErrorKey(requestError)));
    } finally {
      await mutate();
      setSending(false);
    }
  }

  async function invite() {
    setGenerating(true);
    try {
      await generatePostComment(kind, id, crypto.randomUUID());
    } catch (requestError) {
      toast.error(t(postCommentErrorKey(requestError)));
    } finally {
      await mutate();
      setGenerating(false);
    }
  }
  async function remove(threadId: string) {
    setDeleting(threadId);
    try {
      await deletePostComment(kind, id, threadId);
      await mutate();
    } catch (requestError) {
      toast.error(t(postCommentErrorKey(requestError)));
    } finally {
      setDeleting(null);
    }
  }
  return (
    <section className="border-t px-4 pt-4" aria-label={t('title')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium">{t('title')}</h2>
        </div>
        {owner && (
          <Button
            size="sm"
            onClick={() => void invite()}
            disabled={generating || sending || !canReply || aiRoleCount >= 3}
          >
            {generating ? t('generating') : t('invite')}
          </Button>
        )}
      </div>
      {isLoading && <p role="status">{t('loading')}</p>}
      {error && (
        <Button variant="outline" onClick={() => void mutate()}>
          {t('retryLoad')}
        </Button>
      )}
      {data?.length === 0 && <p className="text-muted-foreground text-sm">{t('empty')}</p>}
      <div className="divide-y">
        {data?.map((thread) => (
          <ReplyThread
            key={thread.id}
            thread={thread}
            author={commentAuthor}
            owner={owner}
            canReply={canReply}
            busy={sending}
            deleting={deleting === thread.id}
            expanded={expandedIds.has(thread.id)}
            onToggle={() => toggleThread(thread.id)}
            onSelect={() => selectThread(thread.id)}
            onDelete={() => void remove(thread.id)}
            onRetry={(turn) => void send(thread, turn)}
          />
        ))}
      </div>
      {canReply && (
        <ReplyComposer
          name={targetName}
          avatar={commentAuthor.avatar}
          content={content}
          sending={sending}
          disabled={!target || Boolean(targetRunning)}
          onChange={setContent}
          onSend={() => {
            if (target) void send(target);
          }}
          focusKey={selectedId}
        />
      )}
    </section>
  );
}
