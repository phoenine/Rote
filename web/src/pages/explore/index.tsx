import NavBar from '@/components/layout/navBar';
import EveDayOneCat from '@/components/others/EveDayOneCat';
import RoteList from '@/components/rote/roteList';
import { useSiteStatus } from '@/hooks/useSiteStatus';
import ContainerWithSideBar from '@/layout/ContainerWithSideBar';
import type { ApiGetRotesParams, Rotes } from '@/types/main';
import { useAPIInfinite } from '@/utils/fetcher';
import { getRotesV2 } from '@/utils/roteApi';
import { Activity, ArrowUpRight, Globe2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
function ExplorePage() {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.explore' });

  const getPropsPublic = (
    pageIndex: number,
    _previousPageData: Rotes | null
  ): ApiGetRotesParams | null => ({
    apiType: 'public',
    params: {
      limit: 20,
      skip: pageIndex * 20,
    },
  });

  const { data, mutate, loadMore, isLoading, isValidating } = useAPIInfinite(
    getPropsPublic,
    getRotesV2,
    {
      initialSize: 0,
      revalidateOnMount: true,
    }
  );

  const refreshData = () => {
    if (isLoading || isValidating) {
      return;
    }
    mutate();
  };

  return (
    <ContainerWithSideBar sidebar={<EveDayOneCat />}>
      <NavBar title={t('title')} icon={<Globe2 className="size-5" />} onNavClick={refreshData}>
        {isLoading ||
          (isValidating && (
            <RefreshCw className="text-primary ml-auto size-4 animate-spin duration-300" />
          ))}
      </NavBar>
      <Announcement />
      <RoteList
        data={data}
        loadMore={loadMore}
        mutate={mutate}
        isValidating={isValidating}
        showAuthorActions
      />
    </ContainerWithSideBar>
  );
}

const Announcement = () => {
  const { data: siteStatus } = useSiteStatus();
  const announcement = siteStatus?.site?.announcement;

  if (!announcement?.enabled || !announcement?.content) {
    return null;
  }

  const content = (
    <div
      className={`animate-show bg-foreground/2 block px-4 py-4 text-sm font-light duration-300 ${announcement.link ? 'hover:underline' : ''}`}
    >
      <Activity className="mr-2 inline size-3" />
      <div className="inline">{announcement.content}</div>
      {announcement.link && <ArrowUpRight className="ml-1 inline size-3" />}
    </div>
  );

  if (announcement.link) {
    return (
      <Link to={announcement.link} target="_blank">
        {content}
      </Link>
    );
  }

  return content;
};

export default ExplorePage;
