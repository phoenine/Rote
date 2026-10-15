import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import UserAvatar from '@/components/others/UserAvatar';
import { Button } from '@/components/ui/button';
import { formatTimeAgo } from '@/utils/main';
import { type PostComment, type PostReplyTurn } from './api';
import { getPersonaAvatar } from './personaAvatars';

type Author = { name: string; avatar?: string | null };
type Props = {
  thread: PostComment;
  author: Author;
  owner: boolean;
  canReply: boolean;
  busy: boolean;
  deleting: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onDelete: () => void;
  onRetry: (turn: PostReplyTurn) => void;
};

export function ReplyThread({
  thread,
  author,
  owner,
  canReply,
  busy,
  deleting,
  expanded,
  onToggle,
  onSelect,
  onDelete,
  onRetry,
}: Props) {
  const { t } = useTranslation('translation', { keyPrefix: 'components.postComments' });
  const name = thread.personaId ? t(`personas.${thread.personaId}`) : t('legacyName');
  const running = thread.turns?.some((turn) => turn.status === 'running');
  const replyCount = (thread.turns || []).reduce(
    (total, turn) => total + 1 + Number(turn.status === 'completed'),
    0
  );
  return (
    <article className="flex gap-3 py-4">
      <UserAvatar
        avatar={getPersonaAvatar(thread.personaId)}
        className="size-9 shrink-0 rounded-md"
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="text-sm font-medium text-[#576b95] dark:text-blue-300"
            disabled={!canReply || thread.legacy || thread.status !== 'completed'}
            onClick={onSelect}
            aria-label={t('replyTo', { name })}
          >
            {name}
          </button>
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            {thread.createdAt && (
              <time dateTime={thread.createdAt}>{formatTimeAgo(thread.createdAt)}</time>
            )}
            {owner && (
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                disabled={deleting || busy}
                onClick={onDelete}
                aria-label={t('deleteRole', { name })}
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
        <button
          type="button"
          className="block w-full text-left text-sm leading-relaxed whitespace-pre-wrap"
          onClick={onSelect}
          disabled={!canReply || thread.legacy || thread.status !== 'completed'}
          aria-label={t('selectReply', { name })}
        >
          {thread.status === 'completed' ? thread.content : t(thread.status)}
        </button>
        {thread.legacy && <p className="text-muted-foreground text-xs">{t('legacyPrivate')}</p>}
        {owner && !thread.legacy && thread.publicSafe === false && (
          <p className="text-muted-foreground text-xs">{t('privateContext')}</p>
        )}
        {thread.stale && <p className="text-muted-foreground text-xs">{t('stale')}</p>}
        {replyCount > 0 && (
          <button
            type="button"
            className="text-muted-foreground flex items-center gap-1 py-1 text-xs"
            onClick={onToggle}
            aria-expanded={expanded}
          >
            {expanded ? t('collapseReplies') : t('expandReplies', { count: replyCount })}
            {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
        )}
        {expanded &&
          thread.turns?.map((turn) => (
            <div key={turn.id} className="space-y-3 border-l pt-2 pl-3">
              {owner && turn.publicSafe === false && (
                <p className="text-muted-foreground text-xs">{t('privateContext')}</p>
              )}
              <div className="flex gap-2">
                <UserAvatar avatar={author.avatar} className="size-7 shrink-0 rounded-md" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#576b95] dark:text-blue-300">
                    {author.name}{' '}
                    <span className="text-muted-foreground font-normal">
                      {t('replyTarget', { name })}
                    </span>
                  </p>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{turn.userContent}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <UserAvatar
                  avatar={getPersonaAvatar(thread.personaId)}
                  className="size-7 shrink-0 rounded-md"
                />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="text-sm font-medium text-[#576b95] dark:text-blue-300"
                    disabled={!canReply}
                    onClick={onSelect}
                    aria-label={t('replyTo', { name })}
                  >
                    {name}
                  </button>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {turn.status === 'completed' ? turn.replyContent : t(turn.status)}
                  </p>
                  {canReply && turn.status === 'failed' && turn.requestId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-1 h-7 px-0 text-xs"
                      disabled={busy || running}
                      onClick={() => onRetry(turn)}
                    >
                      {t('retryReply')}
                    </Button>
                  )}
                </div>
              </div>
              {turn.stale && <p className="text-muted-foreground text-xs">{t('stale')}</p>}
            </div>
          ))}
      </div>
    </article>
  );
}
