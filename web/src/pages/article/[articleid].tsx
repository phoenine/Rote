import { PostComments } from '@/features/post-comments/PostComments';
import ArticleNavBarActions from '@/components/article/ArticleNavBarActions';
import { ArticleDeleteConfirmDialog } from '@/components/article/ArticleDeleteConfirmDialog';
import { VerifiedIcon } from '@/components/icons/Verified';
import NavBar from '@/components/layout/navBar';
import LoadingPlaceholder from '@/components/others/LoadingPlaceholder';
import PageRequestError from '@/components/others/PageRequestError';
import UserAvatar from '@/components/others/UserAvatar';
import { Button } from '@/components/ui/button';
import { viewerAwareCacheKey } from '@/features/user-blocks/viewerCacheScope';
import { useArticleActions } from '@/hooks/useArticleActions';
import ContainerWithSideBar from '@/layout/ContainerWithSideBar';
import { profileAtom } from '@/state/profile';
import { get } from '@/utils/api';
import { isNotFoundError } from '@/utils/error';
import { useAPIGet } from '@/utils/fetcher';
import { parseMarkdownMeta } from '@/utils/markdownParser';
import { useAtomValue } from 'jotai';
import {
  ArrowUpRight,
  BookOpen,
  Link as LinkIcon,
  Navigation,
  PenBox,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ArticleMarkdown } from '@/components/article/ArticleMarkdown';
import { Link, useNavigate, useParams } from 'react-router-dom';

function ArticleDetailPage() {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.article' });
  const navigate = useNavigate();
  const { articleid } = useParams();
  const profile = useAtomValue(profileAtom);

  const {
    data: article,
    isLoading,
    error,
    mutate,
    isValidating,
  } = useAPIGet<any>(
    articleid ? viewerAwareCacheKey(`/articles/${articleid}`, profile?.id) : null,
    () => get('/articles/' + articleid).then((res) => res.data),
    {
      revalidateOnFocus: false,
      onError: (err: unknown) => {
        if (isNotFoundError(err)) {
          navigate('/404', { replace: true });
        }
      },
    }
  );

  const refreshData = () => {
    if (isLoading || isValidating) {
      return;
    }
    mutate();
  };

  // 使用共享 hook 处理复制链接和删除操作
  const {
    isDeleting,
    isDeleteConfirmOpen,
    handleCopyLink,
    handleDelete,
    confirmDelete,
    setDeleteConfirmOpen,
  } = useArticleActions({
    articleId: articleid,
    onDeleted: () => {
      navigate('/');
    },
  });

  // 判断是否为作者
  const isAuthor = profile && article?.author && profile.username === article.author.username;

  const hasValidArticle = Boolean(
    article && typeof article === 'object' && article.id && typeof article.content === 'string'
  );
  const hasLoadFailure = Boolean(
    (error && !hasValidArticle) || (!isLoading && !error && !hasValidArticle)
  );

  if (hasLoadFailure) {
    if (isNotFoundError(error)) {
      return null;
    }

    return (
      <PageRequestError
        error={error}
        onRetry={() => {
          void mutate();
        }}
      />
    );
  }

  const SideBar = () =>
    isLoading ? (
      <LoadingPlaceholder className="py-8" size={6} />
    ) : (
      <div className="">
        {article?.author && (
          <div className="border-b p-4">
            <Link to={`/${article.author.username}`} className="block">
              <div className="flex items-center gap-3">
                <UserAvatar
                  avatar={article.author.avatar}
                  className="bg-foreground/5 text-primary size-12"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-primary inline-flex items-center gap-1 truncate font-semibold">
                    {article.author.nickname}
                    {article.author.certified && (
                      <VerifiedIcon className="text-theme size-4 shrink-0" />
                    )}
                  </div>
                  <div className="text-info truncate text-sm">@{article.author.username}</div>
                </div>
              </div>
            </Link>
          </div>
        )}
      </div>
    );

  return isLoading ? (
    <LoadingPlaceholder className="py-16" size={6} />
  ) : article ? (
    <ContainerWithSideBar
      sidebar={<SideBar />}
      sidebarHeader={
        <div className="flex items-center gap-2 p-3 text-lg font-semibold">
          <Navigation className="size-5" />
          <div className="flex items-center gap-2">{t('sideBarTitle')}</div>
        </div>
      }
      floatButtons={
        isAuthor ? (
          <>
            <Button
              size="icon"
              className="rounded-md shadow-md"
              onClick={() => navigate(`/article/${articleid}/edit`)}
              aria-label="Edit article"
              title="Edit article"
            >
              <PenBox className="size-4" />
            </Button>
            <Button
              size="icon"
              className="rounded-md shadow-md"
              onClick={handleCopyLink}
              aria-label="Copy article link"
              title="Copy article link"
            >
              <LinkIcon className="size-4" />
            </Button>
            <Button
              size="icon"
              className="rounded-md shadow-md"
              onClick={handleDelete}
              disabled={isDeleting}
              aria-label="Delete article"
              title="Delete article"
            >
              <Trash2 className="size-4" />
            </Button>
          </>
        ) : null
      }
      className="pb-16"
    >
      <NavBar
        onNavClick={refreshData}
        title={t('title')}
        icon={<BookOpen className="text-primary size-6" />}
      >
        <ArticleNavBarActions
          content={article?.content || ''}
          title={parseMarkdownMeta(article?.content || '').title || ''}
          author={article?.author}
        />
        {isLoading ||
          (isValidating && (
            <RefreshCw className="text-primary size-4 animate-spin p-4 duration-300" />
          ))}
      </NavBar>
      <div className="divide-y">
        <div className="prose prose-sm dark:prose-invert max-w-full p-4">
          <ArticleMarkdown content={article.content} />
        </div>
        {article.note && (
          <Link
            to={`/rote/${article.note.id}`}
            className="block p-4 text-sm font-light hover:underline"
          >
            {t('relatedNote')}: {article.note.content}
            <ArrowUpRight className="inline size-4" />
          </Link>
        )}
      </div>
      <PostComments
        kind="article"
        id={article.id}
        owner={Boolean(isAuthor)}
        author={{
          name: article.author?.nickname || article.author?.username || '',
          avatar: article.author?.avatar,
        }}
      />
      <ArticleDeleteConfirmDialog
        open={isDeleteConfirmOpen}
        isDeleting={isDeleting}
        onConfirm={confirmDelete}
        onOpenChange={setDeleteConfirmOpen}
      />
    </ContainerWithSideBar>
  ) : null;
}

export default ArticleDetailPage;
