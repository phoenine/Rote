import { useTranslation } from 'react-i18next';
import RandomCat from './RandomCat';

const sourceUrl = 'http://motions.cat/index.html';

export default function EveDayOneCat() {
  const { t } = useTranslation('translation', { keyPrefix: 'components.eveDayOneCat' });

  return (
    <div className="flex flex-col">
      <div className="p-4 pb-0 font-semibold">
        {t('title')}
        <div className="text-info text-sm font-normal">
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
            {t('source', { url: sourceUrl })}
          </a>
        </div>
      </div>
      <RandomCat />
      <div className="mx-4 mb-4">{t('hint')}</div>
    </div>
  );
}
