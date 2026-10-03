import type { Catalog, CatalogProduct } from '@macrofill/domain';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiContext, ApiError, guardApi, useApi } from './api/api';
import { DirectEntry } from './directEntry/DirectEntry';
import { createUsageTracker, TrackContext } from './events/track';
import { Login } from './Login';
import { OutboxProvider, useSync, type SaveResult } from './outbox/Outbox';
import { SaveNotice, type Notice } from './SaveNotice';
import { ScaleHolder, ScaleHolderContext, useCreateScaleDriver } from './scale';
import { ScaleMode } from './scaleMode/ScaleMode';
import { belongsToCurrentUser, lastUser, onUserChangedElsewhere, rememberUser } from './session';
import { useDraftStore, type Draft } from './storage/drafts';
import { TodayView } from './today/TodayView';
import { APP_VERSION } from './version';

/** How long the app waits to learn who's logged in before it shows anything. */
const ME_WAIT_MS = 5000;

/** How often a kept session blocked by another tab is tried again. */
const DRAFT_RETRY_MS = 1000;

type Screen = 'home' | 'scaleMode' | 'directEntry';

export function App() {
  const { t } = useTranslation();
  // The scale outlives a meal: it stays connected for the next one (#89).
  const createScaleDriver = useCreateScaleDriver();
  const [scale] = useState(() => new ScaleHolder(createScaleDriver));
  const [screen, setScreen] = useState<Screen>('home');
  // #88: a save goes straight to the main screen, with this notice on it.
  const [notice, setNotice] = useState<Notice>();
  const noticeCount = useRef(0);
  const showSaved = (result: SaveResult) => {
    setNotice({ id: ++noticeCount.current, result });
    setScreen('home');
  };
  const dismissNotice = useCallback(() => setNotice(undefined), []);
  /** A meal starts: the notice was about the last one. */
  const startMeal = (next: 'scaleMode' | 'directEntry') => {
    setNotice(undefined);
    setScreen(next);
  };
  // M4-2: any request refused for want of a session opens the login form over the app. The screen
  // underneath stays mounted, so a meal in progress survives a login.
  const [needsLogin, setNeedsLogin] = useState(false);
  const [logins, setLogins] = useState(0);
  const baseApi = useApi();
  // M7-8: one tracker per page load. Events go out in batches, and when the page is hidden; a
  // failed send keeps them for the next one. Tracking never blocks or breaks the app.
  const [tracker] = useState(() =>
    createUsageTracker({
      send: (events) => baseApi.sendEvents(events),
      // Refused for good (invalid): dropped. No session, a timeout, too many requests, a server
      // error or no connection: kept for the next send.
      retryable: (error) =>
        !(error instanceof ApiError) || ![400, 403, 404, 409, 413, 422].includes(error.status),
      appVersion: APP_VERSION,
      clientSessionId: crypto.randomUUID(),
      newId: () => crypto.randomUUID(),
    }),
  );
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === 'hidden') void tracker.flush();
    };
    // Leaving the page: the last events go out at once (Scale Mode's flow abandoned, for one),
    // also while the batch sent when the page was hidden is still on its way.
    const leaving = () => tracker.leave();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', leaving);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', leaving);
    };
  }, [tracker]);
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
  // The same, set the moment it changes: a sync in flight reads it before each request, so it
  // stops at once, not after the next render (M5-9).
  const confirmedNow = useRef(false);
  // /api/me couldn't reach the server: offline, the remembered user's queued meals may be listed
  // on their own, where no server data can mix with them (M5-9).
  const [unreachable, setUnreachable] = useState(false);
  /** Asks the server again who's logged in; until it answers, nobody is trusted (M5-9). */
  const recheckUser = useCallback(() => {
    confirmedNow.current = false;
    setConfirmed(false);
    setUnreachable(false);
    setMeAttempt((n) => n + 1);
  }, []);
  /** Someone else now, or nobody was known: what was open may be another user's (M5-8). */
  const userIs = (username: string) => {
    // A kept session of this very user stays, e.g. when their session expired with nobody
    // remembered on the device: it's theirs (M5-8).
    if (username !== user && resume?.username !== username) {
      void drafts.clear();
      setResume(undefined);
      setScreen('home');
    }
    setUser(username);
  };
  const loggedIn = (username: string) => {
    generation.current++;
    confirmedNow.current = true;
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
        confirmedNow.current = true;
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
        // No answer about the user: offline, no answer in time, or a server error.
        setUnreachable(!(error instanceof ApiError) || error.status >= 500);
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
      if (document.visibilityState === 'visible') recheckUser();
    };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [recheckUser]);
  useEffect(() => {
    if (user !== undefined && confirmed) return;
    window.addEventListener('online', recheckUser);
    return () => window.removeEventListener('online', recheckUser);
  }, [user, confirmed, recheckUser]);

  // A login in another tab shares this tab's cookie: the same applies.
  useEffect(
    () =>
      onUserChangedElsewhere((username) => {
        generation.current++;
        // Changed in another tab: the server confirms it again.
        recheckUser();
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
    [user, drafts, recheckUser],
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
  // Once the server has confirmed the user in the current check (it drops a session stamped for
  // someone else) or couldn't be reached (offline, the remembered user's stamp decides), and
  // someone is known. Every re-check clears both, so a session loading meanwhile waits for it.
  if (resumeWaiting && (confirmed || unreachable) && user !== undefined) {
    setResumeWaiting(false);
    // Unless a login as someone else dropped it meanwhile.
    if (resume) setScreen('directEntry');
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
        // Unstamped (not valid in IndexedDB, see parseDraft) or another user's: not resumed.
        if (draft.username === undefined || !belongsToCurrentUser(draft.username)) {
          void drafts.clear();
          return;
        }
        setResume(draft);
        // It waits for the server to say who's logged in: the remembered user may be stale
        // (another tab may have logged in without saving it). See the check above.
        setResumeWaiting(true);
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

  // A meal must belong to someone (M5-8), and a kept one waiting for the server's answer must not
  // be opened by hand meanwhile: it might be someone else's.
  const noStart = user === undefined || resumeWaiting;

  return (
    <ScaleHolderContext value={scale}>
      <TrackContext value={tracker.track}>
        <ApiContext value={api}>
          <OutboxProvider ready={confirmed} readyNow={confirmedNow} offline={unreachable}>
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
                      <button type="button" className="secondary" onClick={recheckUser}>
                        {t('app.retry')}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="primary"
                    disabled={noStart}
                    onClick={() => startMeal('scaleMode')}
                  >
                    {t('home.weighMeal')}
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={noStart}
                    onClick={() => startMeal('directEntry')}
                  >
                    {t('home.logMeal')}
                  </button>
                  {user !== undefined && <TodayView recheckUser={recheckUser} />}
                </section>
              )}
              {screen === 'scaleMode' && (
                <WithCatalog>
                  {(catalog, onProductAdded) => (
                    <ScaleMode
                      catalog={catalog}
                      onProductAdded={onProductAdded}
                      owner={user}
                      onSaved={showSaved}
                      onCancel={() => setScreen('home')}
                    />
                  )}
                </WithCatalog>
              )}
              {screen === 'directEntry' && (
                <WithCatalog>
                  {(catalog, onProductAdded) => (
                    <DirectEntry
                      catalog={catalog}
                      onProductAdded={onProductAdded}
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
            </main>
            <SaveNotice notice={notice} onDismiss={dismissNotice} />
            {needsLogin && <Login onLoggedIn={loggedIn} />}
          </OutboxProvider>
        </ApiContext>
      </TrackContext>
    </ScaleHolderContext>
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

/**
 * Loads the catalog fresh (with the latest last-use times) before rendering its children. A product
 * added meanwhile (#64) joins it without loading again: the children only re-render.
 */
function WithCatalog({
  children,
}: {
  children: (
    catalog: Catalog,
    onProductAdded: (product: CatalogProduct) => void,
  ) => React.ReactNode;
}) {
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

  const productAdded = useCallback(
    (product: CatalogProduct) =>
      setCatalog((current) =>
        current && !current.products.some((p) => p.id === product.id)
          ? { ...current, products: [...current.products, product] }
          : current,
      ),
    [],
  );

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
  return <>{children(catalog, productAdded)}</>;
}
