import { useState } from 'react';
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
  type PostKind,
} from './api';

export function PostComments({ kind, id, owner }: { kind: PostKind; id: string; owner: boolean }) {
  const { t } = useTranslation('translation', { keyPrefix: 'components.postComments' });
  const profile = useAtomValue(profileAtom);
  const { capabilities } = usePermissions();
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { data, error, isLoading, mutate } = useAPIGet(
    owner && profile ? { key: 'post-comments', kind, id, viewer: profile.id } : null,
    () => listPostComments(kind, id),
    { revalidateOnFocus: false }
  );
  if (!owner) return null;
  const running = data?.some((comment) => comment.status === 'running');

  async function generate() {
    setGenerating(true);
    try {
      await generatePostComment(kind, id, crypto.randomUUID());
      await mutate();
    } catch (requestError) {
      toast.error(t(postCommentErrorKey(requestError)));
      await mutate();
    } finally {
      setGenerating(false);
    }
  }

  async function remove(commentId: string) {
    setDeleting(commentId);
    try {
      await deletePostComment(kind, id, commentId);
      await mutate();
    } catch (requestError) {
      toast.error(t(postCommentErrorKey(requestError)));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <section className="space-y-3 border-t p-4" aria-label={t('title')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium">{t('title')}</h2>
          <p className="text-muted-foreground text-xs">{t('private')}</p>
        </div>
        <Button
          size="sm"
          onClick={() => void generate()}
          disabled={generating || running || !capabilities?.['ai.chat']?.allowed}
        >
          {generating ? t('generating') : t('generate')}
        </Button>
      </div>
      {isLoading && <p role="status">{t('loading')}</p>}
      {error && (
        <Button variant="outline" onClick={() => void mutate()}>
          {t('retryLoad')}
        </Button>
      )}
      {data?.length === 0 && <p className="text-muted-foreground text-sm">{t('empty')}</p>}
      {data?.map((comment) => (
        <article key={comment.id} className="bg-muted/40 space-y-2 rounded-lg p-3">
          <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
            <span>
              {t('aiLabel')} · {comment.model}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={deleting === comment.id || generating}
              onClick={() => void remove(comment.id)}
            >
              {t('delete')}
            </Button>
          </div>
          {comment.stale && <p className="text-muted-foreground text-xs">{t('stale')}</p>}
          <p className="text-sm whitespace-pre-wrap">
            {comment.status === 'completed' ? comment.content : t(comment.status)}
          </p>
          {comment.status === 'running' && (
            <Button variant="outline" size="sm" onClick={() => void mutate()}>
              {t('refresh')}
            </Button>
          )}
        </article>
      ))}
    </section>
  );
}
