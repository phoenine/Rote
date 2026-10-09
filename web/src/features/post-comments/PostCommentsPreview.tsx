import { useAtomValue } from 'jotai';
import { MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { profileAtom } from '@/state/profile';
import { useAPIGet } from '@/utils/fetcher';
import { listPostComments } from './api';
import UserAvatar from '@/components/others/UserAvatar';
import { getPersonaAvatar } from './personaAvatars';

export function PostCommentsPreview({
  postId,
  active,
  createdAt,
}: {
  postId: string;
  active: boolean;
  createdAt: string;
}) {
  const { t } = useTranslation('translation', { keyPrefix: 'components.postComments' });
  const profile = useAtomValue(profileAtom);
  const { data } = useAPIGet(
    active
      ? { key: 'post-replies', kind: 'rote', id: postId, viewer: profile?.id || 'anonymous' }
      : null,
    () => listPostComments('rote', postId),
    {
      refreshInterval: () =>
        active && Date.now() - new Date(createdAt).getTime() < 180000 ? 4000 : 0,
    }
  );
  const completed = data?.filter((thread) => thread.status === 'completed') || [];
  const count = completed.reduce(
    (total, thread) =>
      total +
      1 +
      (thread.turns || []).reduce(
        (turnTotal, turn) => turnTotal + 1 + Number(turn.status === 'completed'),
        0
      ),
    0
  );
  return (
    <div className="space-y-2 border-t pt-2">
      <Link
        to={`/rote/${postId}`}
        className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
      >
        <MessageCircle className="size-4" aria-hidden="true" />
        {count ? t('viewCommentsCount', { count }) : t('viewComments')}
      </Link>
      {completed.slice(-2).map((thread) => (
        <Link
          key={thread.id}
          to={`/rote/${postId}`}
          className="bg-muted/40 hover:bg-muted flex gap-2 rounded-md px-3 py-2 text-sm"
        >
          <UserAvatar
            avatar={getPersonaAvatar(thread.personaId)}
            className="size-7 shrink-0 rounded-md"
          />
          <div className="min-w-0 flex-1">
            <span className="font-medium">
              {thread.personaId ? t(`personas.${thread.personaId}`) : t('legacyName')}:{' '}
            </span>
            <span className="text-muted-foreground line-clamp-2">
              {[...(thread.turns || [])].reverse().find((turn) => turn.status === 'completed')
                ?.replyContent || thread.content}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
