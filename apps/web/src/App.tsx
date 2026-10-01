import type { Catalog } from '@macrofill/domain';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiContext, ApiError, guardApi, useApi } from './api/api';
import { DirectEntry } from './directEntry/DirectEntry';
import { Login } from './Login';
import { ScaleMode } from './scaleMode/ScaleMode';
import { belongsToCurrentUser, lastUser, onUserChangedElsewhere, rememberUser } from './session';
import { useDraftStore, type Draft } from './storage/drafts';
import { TodayView } from './today/TodayView';

/** How long the app waits to learn who's logged in before it shows anything. */
const ME_WAIT_MS = 5000;

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
  const drafts = useDraftStore();
  const [user, setUser] = useState(lastUser);
  const [resume, setResume] = useState<Draft>();
  // Bumped by every login, here or in another tab: an older answer about the user is stale.
  const generation = useRef(0);
  // Whether /api/me has answered (or given up): until the user is known, nothing starts.
  const [meSettled, setMeSettled] = useState(false);
  // Asking again (Try again, or back online) while the user is still unknown.
  const [meAttempt, setMeAttempt] = useState(0);
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
    generation.current++;
    setNeedsLogin(false);
    setLogins((n) => n + 1);
    userIs(username);
  };
  // Who the session belongs to, from the server (M4-1): a cookie from before the app remembered
  // users has none on the device. Learning it for the first time isn't a change of user.
  useEffect(() => {
    let current = true;
    const asked = generation.current;
    const answer = Promise.race([
      baseApi.me(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ME_WAIT_MS)),
    ]);
    answer.then(
      (username) => {
        if (!current) return;
        setMeSettled(true);
        // A login since makes this answer stale: the cookie is someone else's now.
        if (asked !== generation.current) return;
        rememberUser(username);
        setUser((known) => {
          if (known !== undefined && known !== username) {
            void drafts.clear();
            setResume(undefined);
            setScreen('home');
            setLogins((n) => n + 1);
          }
          return username;
        });
      },
      (error: unknown) => {
        if (!current) return;
        setMeSettled(true);
        // No session: the login form settles who it is.
        if (error instanceof ApiError && error.status === 401) setNeedsLogin(true);
      },
    );
    return () => {
      current = false;
    };
  }, [baseApi, drafts, meAttempt]);
  useEffect(() => {
    if (user !== undefined) return;
    const online = () => setMeAttempt((n) => n + 1);
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [user]);

  // A login in another tab shares this tab's cookie: the same applies.
  useEffect(
    () =>
      onUserChangedElsewhere((username) => {
        generation.current++;
        if (username !== user) {
          void drafts.clear();
          setResume(undefined);
          setScreen('home');
          // The home screen loads again, for the new user.
          setLogins((n) => n + 1);
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

  // Nothing starts before it's known whose it is: a meal must never belong to nobody (M5-8).
  if (!draftLoaded || (user === undefined && !meSettled)) return null;

  return (
    <ApiContext value={api}>
      <main hidden={needsLogin}>
        {screen === 'home' && (
          // Keyed by logins, so what failed without a session loads again after one.
          <section key={logins}>
            <h1>{t('app.name')}</h1>
            {/* A meal must belong to someone: none starts until the user is known (M5-8). */}
            {user === undefined && (
              <>
                <p role="alert" className="problem">
                  {t('home.userUnknown')}
                </p>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setMeAttempt((n) => n + 1)}
                >
                  {t('app.retry')}
                </button>
              </>
            )}
            <button
              type="button"
              className="primary"
              disabled={user === undefined}
              onClick={() => setScreen('scaleMode')}
            >
              {t('home.weighMeal')}
            </button>
            <button
              type="button"
              className="primary"
              disabled={user === undefined}
              onClick={() => setScreen('directEntry')}
            >
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
                owner={user}
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
                owner={user}
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
