import type { Catalog } from '@macrofill/domain';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiContext, ApiError, guardApi, useApi } from './api/api';
import { DirectEntry } from './directEntry/DirectEntry';
import { Login } from './Login';
import { OutboxProvider, useSync, type SaveResult } from './outbox/Outbox';
import { ScaleMode } from './scaleMode/ScaleMode';
import { belongsToCurrentUser, lastUser, onUserChangedElsewhere, rememberUser } from './session';
import { useDraftStore, type Draft } from './storage/drafts';
import { TodayView } from './today/TodayView';

/** How long the app waits to learn who's logged in before it shows anything. */
const ME_WAIT_MS = 5000;

/** How often a kept session blocked by another tab is tried again. */
const DRAFT_RETRY_MS = 1000;

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
  // Bumped by every login, here or in another tab: an older answer about the user is stale.
  const generation = useRef(0);
  // Whether /api/me has answered (or given up): until the user is known, nothing starts.
  const [meSettled, setMeSettled] = useState(false);
  // Asking again (Try again, or back online) while the user is still unknown.
  const [meAttempt, setMeAttempt] = useState(0);
  // Whether the server has confirmed who's logged in (/api/me, or a login here). Until then the
  // remembered user may be stale: their queued meals wait (M5-9).
  const [confirmed, setConfirmed] = useState(false);
  // /api/me couldn't reach the server: offline, the remembered user's queued meals may be listed
  // on their own, where no server data can mix with them (M5-9).
  const [unreachable, setUnreachable] = useState(false);
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
    setConfirmed(true);
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
        setConfirmed(true);
        setUnreachable(false);
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
        // A kept session stamped for someone else isn't this user's (M5-8).
        setResume((kept) => {
          if (kept?.username === undefined || kept.username === username) return kept;
          void drafts.clear();
          setScreen('home');
          return undefined;
        });
      },
      (error: unknown) => {
        if (!current) return;
        setMeSettled(true);
        // A login since makes this failure stale too.
        if (asked !== generation.current) return;
        // Not an answer from the server (offline, or no answer in time).
        setUnreachable(!(error instanceof ApiError));
        // No session: the login form settles who it is.
        if (error instanceof ApiError && error.status === 401) setNeedsLogin(true);
      },
    );
    return () => {
      current = false;
    };
  }, [baseApi, drafts, meAttempt]);
  // Back on this tab: who's logged in may have changed meanwhile, also where no storage event
  // says so (local storage blocked), so ask again.
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState !== 'visible') return;
      // Not trusted again until the server answers (M5-9).
      setConfirmed(false);
      setUnreachable(false);
      setMeAttempt((n) => n + 1);
    };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, []);
  useEffect(() => {
    if (user !== undefined && confirmed) return;
    const online = () => setMeAttempt((n) => n + 1);
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [user, confirmed]);

  // A login in another tab shares this tab's cookie: the same applies.
  useEffect(
    () =>
      onUserChangedElsewhere((username) => {
        generation.current++;
        // Changed in another tab: the server confirms it again.
        setConfirmed(false);
        setMeAttempt((n) => n + 1);
        if (username !== user) {
          void drafts.clear();
          setResume(undefined);
          setScreen('home');
          // The home screen loads again, for the new user.
          setLogins((n) => n + 1);
        }
        setUser(username);
        // Logged in elsewhere: what waits for this user is sent now (M5-9).
        setLogins((n) => n + 1);
      }),
    [user, drafts],
  );
  // M5-8: a Direct Entry session kept from before a reload opens again.
  // Nothing is shown until it's known whether there's a kept session: a meal started meanwhile
  // would overwrite it. IndexedDB answers in milliseconds.
  const [draftLoaded, setDraftLoaded] = useState(false);
  // An older version of the app in another tab blocks the database: the kept session waits.
  const [draftBlocked, setDraftBlocked] = useState(false);
  const [draftAttempt, setDraftAttempt] = useState(0);
  // A kept session waiting for the user to be known before it opens (see the draft load).
  const [resumeWaiting, setResumeWaiting] = useState(false);
  if (resumeWaiting && user !== undefined) {
    setResumeWaiting(false);
    setScreen('directEntry');
  }
  useEffect(() => {
    let current = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    void drafts.load().then(
      (draft) => {
        if (!current) return;
        setDraftBlocked(false);
        setDraftLoaded(true);
        if (!draft) return;
        if (!belongsToCurrentUser(draft.username)) {
          void drafts.clear();
          return;
        }
        setResume(draft);
        // A session nobody's stamped on, with nobody known yet: it waits for its owner.
        if (draft.username === undefined && lastUser() === undefined) {
          setResumeWaiting(true);
          return;
        }
        setScreen('directEntry');
      },
      () => {
        if (!current) return;
        setDraftBlocked(true);
        retry = setTimeout(() => setDraftAttempt((n) => n + 1), DRAFT_RETRY_MS);
      },
    );
    return () => {
      current = false;
      clearTimeout(retry);
    };
  }, [drafts, draftAttempt]);
  const leaveDirectEntry = (next: Screen) => {
    setResume(undefined);
    setScreen(next);
  };

  useEffect(() => {
    // index.html has a static title only for the first paint.
    document.title = t('app.name');
  }, [t]);

  // Nothing starts before it's known whose it is: a meal must never belong to nobody (M5-8).
  if (draftBlocked && !draftLoaded) {
    return (
      <main>
        <p role="alert" className="problem">
          {t('app.blocked')}
        </p>
      </main>
    );
  }
  if (!draftLoaded || (user === undefined && !meSettled)) return null;

  return (
    <ApiContext value={api}>
      <OutboxProvider ready={confirmed} offline={unreachable}>
        <SyncAfterLogin logins={logins} user={user} confirmed={confirmed} />
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
                  owner={user}
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
              <h1 role="status">
                {savedResult === 'refused' ? t('saved.refusedTitle') : t('saved.title')}
              </h1>
              {savedResult === 'refused' && (
                <p role="alert" className="problem">
                  {t('saved.refused')}
                </p>
              )}
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

/**
 * M5-9: meals that waited for a session, or for their user, are sent once that user is logged in:
 * after a login, and whenever the known user is established or changes (e.g. /api/me corrects it).
 */
function SyncAfterLogin(props: { logins: number; user: string | undefined; confirmed: boolean }) {
  const { logins, user, confirmed } = props;
  const sync = useSync();
  const first = useRef(true);
  useEffect(() => {
    // The provider syncs on start by itself; nothing goes before the server confirms the user.
    if (first.current) {
      first.current = false;
      return;
    }
    if (confirmed) void sync();
  }, [logins, user, confirmed, sync]);
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
