import {
  targetProgress,
  type NutrientProgress,
  type Today,
  type TodayEntry,
} from '@macrofill/domain';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api';
import { formatGrams, formatKcal, formatTime } from '../format';

/** Today (M7-1 to M7-4): totals against targets and the day's meals, newest first. */
export function TodayView() {
  const { t } = useTranslation();
  const api = useApi();
  const [today, setToday] = useState<Today>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    api.today().then(
      (loaded) => current && setToday(loaded),
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
      </section>
    );
  }
  if (today === undefined) return <p role="status">{t('app.loading')}</p>;

  return (
    <section aria-labelledby="today-title">
      <h2 id="today-title">{t('today.title')}</h2>
      <ProgressTable progress={targetProgress(today.totals, today.targets)} />
      <h3>{t('today.meals')}</h3>
      {today.entries.length === 0 ? (
        <p className="muted">{t('today.empty')}</p>
      ) : (
        <ul className="entries">
          {today.entries.map((entry) => (
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

function Entry(props: { entry: TodayEntry; timezone: string; onDeleted: () => void }) {
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
      <p className="entry-macros">
        {(['kcal', 'protein', 'fat', 'carbs'] as const).map((nutrient) => (
          <span key={nutrient}>
            {t(`nutrient.${nutrient}`)} {format(nutrient, entry.nutrition[nutrient])}
          </span>
        ))}
      </p>
      {confirming ? (
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
