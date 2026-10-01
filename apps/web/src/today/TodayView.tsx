import {
  targetProgress,
  withPending,
  type NutrientProgress,
  type Today,
  type TodayListEntry,
} from '@macrofill/domain';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api';
import { formatGrams, formatKcal, formatTime } from '../format';
import { usePending, useRemovePending } from '../outbox/Outbox';
import { lastTimezone, rememberTimezone } from '../session';
import type { OutboxItem } from '../outbox/store';

/**
 * Today (M7-1 to M7-4): totals against targets and the day's meals, newest first, with the meals
 * still waiting to be sent marked pending and counted (M5-9).
 */
export function TodayView() {
  const { t } = useTranslation();
  const api = useApi();
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

  useEffect(() => {
    let current = true;
    api.today().then(
      (loaded) => {
        if (!current) return;
        // For showing times in the user's timezone offline too.
        rememberTimezone(loaded.timezone);
        setToday(loaded);
      },
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [api, attempt]);

  const reload = () => {
    setFailed(false);
    setAttempt((n) => n + 1);
  };

  if (failed) {
    return (
      <section aria-labelledby="today-title">
        <h2 id="today-title">{t('today.title')}</h2>
        <p role="alert" className="problem">
          {t('today.loadFailed')}
        </p>
        <button type="button" className="secondary" onClick={reload}>
          {t('app.retry')}
        </button>
        <Refused items={offline.refused} timezone={offlineTimeZone()} />
        {/* Offline, the day can't load, but what's waiting on this device can be shown. */}
        {offline.pending.length > 0 && (
          <>
            <h3>{t('today.pendingTitle')}</h3>
            <ul className="entries">
              {offline.pending.map((entry) => (
                <Entry
                  key={entry.id}
                  entry={{ ...entry, pending: true }}
                  timezone={offlineTimeZone()}
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

/** Offline: the user's timezone from the last time Today loaded, else the device's (M7-1). */
function offlineTimeZone(): string {
  return lastTimezone() ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
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
