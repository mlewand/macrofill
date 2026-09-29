import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export function App() {
  const { t } = useTranslation();

  useEffect(() => {
    // index.html has a static title only for the first paint.
    document.title = t('app.name');
  }, [t]);

  return (
    <main>
      <h1>{t('app.name')}</h1>
    </main>
  );
}
