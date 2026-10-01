import type { Catalog } from '@macrofill/domain';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiContext, guardApi, useApi } from './api/api';
import { DirectEntry } from './directEntry/DirectEntry';
import { Login } from './Login';
import { ScaleMode } from './scaleMode/ScaleMode';
import { TodayView } from './today/TodayView';

type Screen = 'home' | 'scaleMode' | 'directEntry' | 'saved';

export function App() {
  const { t } = useTranslation();
  const [screen, setScreen] = useState<Screen>('home');
  // M4-2: any request refused for want of a session opens the login form over the app. The screen
  // underneath stays mounted, so a meal in progress survives a login.
  const [needsLogin, setNeedsLogin] = useState(false);
  const [logins, setLogins] = useState(0);
  const baseApi = useApi();
  const api = useMemo(() => guardApi(baseApi, () => setNeedsLogin(true)), [baseApi]);
  const loggedIn = () => {
    setNeedsLogin(false);
    setLogins((n) => n + 1);
  };

  useEffect(() => {
    // index.html has a static title only for the first paint.
    document.title = t('app.name');
  }, [t]);

  return (
    <ApiContext value={api}>
      <main hidden={needsLogin}>
        {screen === 'home' && (
          // Keyed by logins, so what failed without a session loads again after one.
          <section key={logins}>
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
                onSaved={() => setScreen('saved')}
                onCancel={() => setScreen('home')}
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
      {needsLogin && <Login onLoggedIn={loggedIn} />}
    </ApiContext>
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
