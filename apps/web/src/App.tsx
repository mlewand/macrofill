import type { Catalog } from '@macrofill/domain';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiContext, guardApi, useApi } from './api/api';
import { DirectEntry } from './directEntry/DirectEntry';
import { Login } from './Login';
import { OutboxProvider, useSync, type SaveResult } from './outbox/Outbox';
import { ScaleMode } from './scaleMode/ScaleMode';
import { belongsToCurrentUser, lastUser, onUserChangedElsewhere, rememberUser } from './session';
import { useDraftStore, type Draft } from './storage/drafts';
import { TodayView } from './today/TodayView';

type Screen = 'home' | 'scaleMode' | 'directEntry' | 'saved';

export function App() {
  const { t } = useTranslation();
  const [screen, setScreen] = useState<Screen>('home');
  const [savedResult, setSavedResult] = useState<SaveResult>('synced');
  const showSaved = (result: SaveResult) => {
    setSavedResult(result);
    setScreen('saved');
  };
  // M4-2: any request refused for want of a session opens the login form over the app. The screen
  // underneath stays mounted, so a meal in progress survives a login.
  const [needsLogin, setNeedsLogin] = useState(false);
  const [logins, setLogins] = useState(0);
  const baseApi = useApi();
  const api = useMemo(() => guardApi(baseApi, () => setNeedsLogin(true)), [baseApi]);
  const drafts = useDraftStore();
  const [user, setUser] = useState(lastUser);
  const [resume, setResume] = useState<Draft>();
  /** Someone else now, or nobody was known: what was open may be another user's (M5-8). */
  const userIs = (username: string) => {
    if (username !== user) {
      void drafts.clear();
      setResume(undefined);
      setScreen('home');
    }
    setUser(username);
  };
  const loggedIn = (username: string) => {
    setNeedsLogin(false);
    setLogins((n) => n + 1);
    userIs(username);
  };
  // Who the session belongs to, from the server (M4-1): a cookie from before the app remembered
  // users has none on the device. Learning it for the first time isn't a change of user.
  useEffect(() => {
    let current = true;
    baseApi.me().then(
      (username) => {
        if (!current) return;
        rememberUser(username);
        setUser((known) => {
          if (known !== undefined && known !== username) {
            void drafts.clear();
            setResume(undefined);
            setScreen('home');
          }
          return username;
        });
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [baseApi, drafts]);

  // A login in another tab shares this tab's cookie: the same applies.
  useEffect(
    () =>
      onUserChangedElsewhere((username) => {
        if (username !== user) {
          void drafts.clear();
          setResume(undefined);
          setScreen('home');
        }
        setUser(username);
      }),
    [user, drafts],
  );
  // M5-8: a Direct Entry session kept from before a reload opens again.
  // Nothing is shown until it's known whether there's a kept session: a meal started meanwhile
  // would overwrite it. IndexedDB answers in milliseconds.
  const [draftLoaded, setDraftLoaded] = useState(false);
  useEffect(() => {
    let current = true;
    void drafts.load().then((draft) => {
      if (!current) return;
      setDraftLoaded(true);
      if (!draft) return;
      if (!belongsToCurrentUser(draft.username)) {
        void drafts.clear();
        return;
      }
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
    <ApiContext value={api}>
      <OutboxProvider>
        <SyncAfterLogin logins={logins} />
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
                  onSaved={showSaved}
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
                  onSaved={(result) => {
                    setResume(undefined);
                    showSaved(result);
                  }}
                  onCancel={() => leaveDirectEntry('home')}
                  {...(resume ? { resume } : {})}
                />
              )}
            </WithCatalog>
          )}
          {screen === 'saved' && (
            <section>
              <h1 role="status">{t('saved.title')}</h1>
              {/* M5-9: kept on the device until the server has it. */}
              {savedResult === 'pending' && <p>{t('saved.pending')}</p>}
              <button type="button" className="primary" onClick={() => setScreen('home')}>
                {t('saved.done')}
              </button>
            </section>
          )}
        </main>
        {needsLogin && <Login onLoggedIn={loggedIn} />}
      </OutboxProvider>
    </ApiContext>
  );
}

/** M5-9: meals that waited for a session are sent once logged in. */
function SyncAfterLogin({ logins }: { logins: number }) {
  const sync = useSync();
  useEffect(() => {
    if (logins > 0) void sync();
  }, [logins, sync]);
  return null;
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
