import {
  localDay,
  targetProgress,
  withPending,
  type NutrientProgress,
  type Today,
  type TodayListEntry,
} from '@macrofill/domain';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api';
import { formatGrams, formatKcal, formatTime } from '../format';
import { usePending, useRemovePending, useUserStatus } from '../outbox/Outbox';
import { lastTimezone, lastUser, rememberTimezone } from '../session';
import type { OutboxItem } from '../outbox/store';

/** How often Today loads the day again by itself while the tab is visible (#77-2). */
export const REFRESH_INTERVAL_MS = 30_000;

/**
 * Today (M7-1 to M7-4): totals against targets and the day's meals, newest first, with the meals
 * still waiting to be sent marked pending and counted (M5-9).
 */
export function TodayView(props: {
  /** Asks the server again who's logged in: Try again, while it hasn't confirmed the user. */
  recheckUser?: () => void;
}) {
  const { recheckUser } = props;
  const { t } = useTranslation();
  const api = useApi();
  // The server's day is loaded only once the server has confirmed the user (M4-1): the session
  // cookie may be someone else's than the remembered user's. A day already shown stays while the
  // user is checked again; a different answer starts over (App).
  const { ready, offline: unreachable } = useUserStatus();
  // Next to the server's day only once the server has confirmed the user (M5-9); offline, when the
  // day can't load, the remembered user's are shown on their own.
  const { pending, refused } = split(usePending());
  const offline = split(usePending({ unconfirmed: true }));
  const [today, setToday] = useState<Today>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // A meal leaving the outbox is on the server now: load the day again. One joining it needs no
  // reload: it's merged in below.
  const pendingIds = pending.map((e) => e.id);
  const [lastPendingIds, setLastPendingIds] = useState(pendingIds);
  if (pendingIds.join() !== lastPendingIds.join()) {
    setLastPendingIds(pendingIds);
    if (lastPendingIds.some((id) => !pendingIds.includes(id))) {
      setFailed(false);
      setAttempt((n) => n + 1);
    }
  }

  // Loads of the day, to tell a load that was overtaken from the one that counts: a refresh
  // answering after a later load, or after the user changed, is dropped (#77-5).
  const loadState = useRef({ count: 0, loading: false });

  useEffect(() => {
    if (!ready) return;
    const state = loadState.current;
    const load = ++state.count;
    state.loading = true;
    // Whose day this is: the user confirmed now, not whoever is remembered when it arrives.
    const askedFor = lastUser();
    api.today().then(
      (loaded) => {
        if (load !== state.count) return;
        state.loading = false;
        // For showing times in the user's timezone offline too.
        if (lastUser() === askedFor) rememberTimezone(askedFor, loaded.timezone);
        // Also after an automatic reload (the user confirmed again): it loaded now.
        setFailed(false);
        setToday(loaded);
      },
      () => {
        if (load !== state.count) return;
        state.loading = false;
        setFailed(true);
      },
    );
    return () => {
      state.count++;
      state.loading = false;
    };
  }, [api, attempt, ready]);

  // #77: other devices and windows save meals too, so Today catches up by itself when the window
  // gets focus and every 30 seconds while the tab is visible. It's silent: the day on screen stays
  // until the new one arrives, and a refresh that fails changes nothing (#77-3, #77-4).
  useEffect(() => {
    if (!ready) return;
    const state = loadState.current;
    let refreshing = false;
    const refresh = () => {
      if (document.visibilityState !== 'visible' || refreshing || state.loading) return;
      refreshing = true;
      const load = state.count;
      const askedFor = lastUser();
      api.today().then(
        (loaded) => {
          refreshing = false;
          if (load !== state.count) return;
          if (lastUser() === askedFor) rememberTimezone(askedFor, loaded.timezone);
          // Brings the day back too, when it couldn't be loaded before.
          setFailed(false);
          setToday(loaded);
        },
        () => {
          refreshing = false;
        },
      );
    };
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      window.removeEventListener('focus', refresh);
      clearInterval(timer);
    };
  }, [api, ready]);

  const reload = () => {
    setFailed(false);
    setAttempt((n) => n + 1);
    if (!ready) recheckUser?.();
  };

  // While the server checks the user again (back on the tab), nothing from before shows: neither
  // the day loaded then (another tab may have logged in as someone else, M4-1) nor its failure.
  if (!ready && !unreachable) return <p role="status">{t('app.loading')}</p>;
  // Offline with the user unconfirmed, an earlier day isn't shown: the remembered user's queued
  // meals are, on their own.
  if (failed || !ready) {
    // Today's only (M7-1), in the user's timezone: a meal queued before midnight isn't today's.
    const timezone = offlineTimeZone();
    const day = localDay(new Date(), timezone);
    const pendingToday = offline.pending.filter(
      (entry) => localDay(entry.eatenAt, timezone) === day,
    );
    return (
      <section aria-labelledby="today-title">
        <h2 id="today-title">{t('today.title')}</h2>
        <p role="alert" className="problem">
          {t('today.loadFailed')}
        </p>
        <button type="button" className="secondary" onClick={reload}>
          {t('app.retry')}
        </button>
        <Refused items={offline.refused} timezone={timezone} />
        {/* Offline, the day can't load, but what's waiting on this device can be shown. */}
        {pendingToday.length > 0 && (
          <>
            <h3>{t('today.pendingTitle')}</h3>
            <ul className="entries">
              {pendingToday.map((entry) => (
                <Entry
                  key={entry.id}
                  entry={{ ...entry, pending: true }}
                  timezone={timezone}
                  onDeleted={reload}
                />
              ))}
            </ul>
          </>
        )}
      </section>
    );
  }
  if (today === undefined) return <p role="status">{t('app.loading')}</p>;

  const { entries, totals } = withPending(today, pending);
  return (
    <section aria-labelledby="today-title">
      <h2 id="today-title">{t('today.title')}</h2>
      <Refused items={refused} timezone={today.timezone} />
      <ProgressTable progress={targetProgress(totals, today.targets)} />
      <h3>{t('today.meals')}</h3>
      {entries.length === 0 ? (
        <p className="muted">{t('today.empty')}</p>
      ) : (
        <ul className="entries">
          {entries.map((entry) => (
            <Entry key={entry.id} entry={entry} timezone={today.timezone} onDeleted={reload} />
          ))}
        </ul>
      )}
    </section>
  );
}

function useFormatValue() {
  const { t } = useTranslation();
  return (nutrient: NutrientProgress['nutrient'], value: number | null) => {
    if (value === null) return t('unknown');
    return nutrient === 'kcal'
      ? t('unit.kcal', { value: formatKcal(value) })
      : t('unit.grams', { value: formatGrams(value) });
  };
}

/** M7-2: consumed, target and remaining. A nutrient without a target shows only consumed. */
function ProgressTable({ progress }: { progress: NutrientProgress[] }) {
  const { t } = useTranslation();
  const format = useFormatValue();
  return (
    <table className="progress-table">
      <thead>
        <tr>
          <th scope="col">{t('today.nutrient')}</th>
          <th scope="col">{t('today.eaten')}</th>
          <th scope="col">{t('today.target')}</th>
          <th scope="col">{t('today.remaining')}</th>
        </tr>
      </thead>
      <tbody>
        {progress.map((row) => (
          <tr key={row.nutrient}>
            <th scope="row">{t(`nutrient.${row.nutrient}`)}</th>
            <td>{format(row.nutrient, row.consumed)}</td>
            <td>{row.target === null ? null : format(row.nutrient, row.target)}</td>
            <td className={row.remaining !== null && row.remaining < 0 ? 'over' : undefined}>
              {row.target === null ? null : format(row.nutrient, row.remaining)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * M5-9: meals the server refused for good, with times in the user's timezone (or the device's,
 * when Today couldn't load). They stay on the device until the user has seen them
 * and removes them; nothing is lost silently.
 */
function Refused({ items, timezone }: { items: OutboxItem[]; timezone: string }) {
  const { t } = useTranslation();
  const remove = useRemovePending();
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="refused-title">
      <h3 id="refused-title">{t('today.refusedTitle')}</h3>
      <p role="alert" className="problem">
        {t('today.refusedHint')}
      </p>
      <ul className="entries">
        {items.map(({ entry }) => (
          <li key={entry.id} className="entry">
            <div className="entry-head">
              <strong>{entry.recipeName?.en ?? t('today.meal')}</strong>
              <time dateTime={entry.eatenAt}>{formatTime(entry.eatenAt, timezone)}</time>
            </div>
            <button
              type="button"
              className="secondary"
              onClick={() => void remove(entry.preparedMealId)}
            >
              {t('today.remove')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Waiting to be sent, newest first like the day's list (M7-1), and counted; refused ones are
 * shown apart, and not counted.
 */
function split(items: OutboxItem[]) {
  return {
    pending: items
      .filter((item) => item.refused === undefined)
      .map((item) => item.entry)
      .sort((a, b) => Date.parse(b.eatenAt) - Date.parse(a.eatenAt)),
    refused: items.filter((item) => item.refused !== undefined),
  };
}

/**
 * Offline: the user's timezone from the last time Today loaded for them, else the device's (M7-1).
 */
function offlineTimeZone(): string {
  return lastTimezone(lastUser()) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function Entry(props: { entry: TodayListEntry; timezone: string; onDeleted: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const format = useFormatValue();
  const { entry } = props;
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);
  const name = entry.recipeName?.en ?? t('today.meal');
  const time = formatTime(entry.eatenAt, props.timezone);

  const remove = async () => {
    setDeleting(true);
    setFailed(false);
    try {
      await api.deleteEntry(entry.id);
      props.onDeleted();
    } catch {
      setFailed(true);
      setDeleting(false);
    }
  };

  return (
    <li className="entry">
      <div className="entry-head">
        <strong>{name}</strong>
        <time dateTime={entry.eatenAt}>{time}</time>
      </div>
      {entry.pending && <p className="pending">{t('today.pending')}</p>}
      <p className="entry-macros">
        {(['kcal', 'protein', 'fat', 'carbs'] as const).map((nutrient) => (
          <span key={nutrient}>
            {t(`nutrient.${nutrient}`)} {format(nutrient, entry.nutrition[nutrient])}
          </span>
        ))}
      </p>
      {/* A pending meal isn't on the server yet, so there's nothing to delete there. */}
      {entry.pending ? null : confirming ? (
        <div className="confirm" role="group" aria-label={t('today.confirmDelete')}>
          <p>{t('today.confirmDelete')}</p>
          <div className="row">
            <button
              type="button"
              className="danger"
              disabled={deleting}
              onClick={() => void remove()}
            >
              {t('today.confirm')}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={deleting}
              onClick={() => setConfirming(false)}
            >
              {t('today.keep')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="secondary"
          aria-label={t('today.deleteLabel', { meal: name, time })}
          onClick={() => setConfirming(true)}
        >
          {t('today.delete')}
        </button>
      )}
      {failed && (
        <p role="alert" className="problem">
          {t('today.deleteFailed')}
        </p>
      )}
    </li>
  );
}
