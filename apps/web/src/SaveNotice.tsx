import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { SaveResult } from './outbox/Outbox';

/** How long a notice that needs no action stays (#88-2). */
export const NOTICE_MS = 5000;

/** What the last save came to (#88). `id` tells a second save from the first. */
export interface Notice {
  id: number;
  result: SaveResult;
}

/**
 * The notice after a meal is saved (#88): "Meal saved", or that the meal is kept for later, hides
 * itself after `NOTICE_MS`. A refused meal is an alert that stays until dismissed, because the
 * meal isn't saved and the user has to look at it (#88-3).
 *
 * The polite region is always on the page, empty until there's something to say: a region that
 * appears together with its text is often not announced (#88-6). It's a plain live region, not
 * `role="status"`, like the scale's status, so it doesn't clash with the messages on screens that
 * already use that role. The alert is only rendered when there is one: `role="alert"` is
 * announced when it appears.
 */
export function SaveNotice({
  notice,
  onDismiss,
}: {
  notice: Notice | undefined;
  /** Must keep its identity between renders, or the countdown restarts. */
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const refused = notice?.result === 'refused';

  // Cleared when the notice is replaced, dismissed or its screen goes away (#88-6).
  useEffect(() => {
    if (notice === undefined || notice.result === 'refused') return;
    const timer = setTimeout(onDismiss, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, onDismiss]);

  return (
    <div className={notice ? 'notice' : undefined}>
      <div aria-live="polite" aria-atomic="true">
        {notice && !refused && (
          <>
            <p className="notice-title">{t('saved.title')}</p>
            {notice.result === 'pending' && <p>{t('saved.pending')}</p>}
          </>
        )}
      </div>
      {refused && (
        <div role="alert">
          <p className="notice-title problem">{t('saved.refusedTitle')}</p>
          <p>{t('saved.refused')}</p>
        </div>
      )}
      {notice && (
        <button type="button" className="secondary" onClick={onDismiss}>
          {t('notice.dismiss')}
        </button>
      )}
    </div>
  );
}
