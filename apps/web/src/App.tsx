import type { Catalog } from '@macrofill/domain';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from './api/api';
import { DirectEntry } from './directEntry/DirectEntry';
import type { DirectEntryState } from './directEntry/state';
import { ScaleMode } from './scaleMode/ScaleMode';
import { useDraftStore } from './storage/drafts';
import { TodayView } from './today/TodayView';

type Screen = 'home' | 'scaleMode' | 'directEntry' | 'saved';

export function App() {
  const { t } = useTranslation();
  const [screen, setScreen] = useState<Screen>('home');
  // M5-8: a Direct Entry session kept from before a reload opens again.
  const drafts = useDraftStore();
  const [resume, setResume] = useState<DirectEntryState>();
  // Nothing is shown until it's known whether there's a kept session: a meal started meanwhile
  // would overwrite it. IndexedDB answers in milliseconds.
  const [draftLoaded, setDraftLoaded] = useState(false);
  useEffect(() => {
    let current = true;
    void drafts.load().then((draft) => {
      if (!current) return;
      setDraftLoaded(true);
      if (!draft) return;
      setResume(draft);
      setScreen('directEntry');
    });
    return () => {
      current = false;
    };
  }, [drafts]);
  const leaveDirectEntry = (next: Screen) => {
    setResume(undefined);
    setScreen(next);
  };

  useEffect(() => {
    // index.html has a static title only for the first paint.
    document.title = t('app.name');
  }, [t]);

  if (!draftLoaded) return null;

  return (
    <main>
      {screen === 'home' && (
        <section>
          <h1>{t('app.name')}</h1>
          <button type="button" className="primary" onClick={() => setScreen('scaleMode')}>
            {t('home.weighMeal')}
          </button>
          <button type="button" className="primary" onClick={() => setScreen('directEntry')}>
            {t('home.logMeal')}
          </button>
          <TodayView />
        </section>
      )}
      {screen === 'scaleMode' && (
        <WithCatalog>
          {(catalog) => (
            <ScaleMode
              catalog={catalog}
              onSaved={() => setScreen('saved')}
              onCancel={() => setScreen('home')}
            />
          )}
        </WithCatalog>
      )}
      {screen === 'directEntry' && (
        <WithCatalog>
          {(catalog) => (
            <DirectEntry
              catalog={catalog}
              onSaved={() => leaveDirectEntry('saved')}
              onCancel={() => leaveDirectEntry('home')}
              {...(resume ? { resume } : {})}
            />
          )}
        </WithCatalog>
      )}
      {screen === 'saved' && (
        <section>
          <h1 role="status">{t('saved.title')}</h1>
          <button type="button" className="primary" onClick={() => setScreen('home')}>
            {t('saved.done')}
          </button>
        </section>
      )}
    </main>
  );
}

/** Loads the catalog fresh (with the latest last-use times) before rendering its children. */
function WithCatalog({ children }: { children: (catalog: Catalog) => React.ReactNode }) {
  const { t } = useTranslation();
  const api = useApi();
  const [catalog, setCatalog] = useState<Catalog>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    api.catalog().then(
      (loaded) => current && setCatalog(loaded),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [api, attempt]);

  const retry = () => {
    setFailed(false);
    setAttempt((n) => n + 1);
  };

  if (failed) {
    return (
      <section>
        <p role="alert" className="problem">
          {t('app.loadFailed')}
        </p>
        <button type="button" className="primary" onClick={retry}>
          {t('app.retry')}
        </button>
      </section>
    );
  }
  if (catalog === undefined) return <p role="status">{t('app.loading')}</p>;
  return <>{children(catalog)}</>;
}
