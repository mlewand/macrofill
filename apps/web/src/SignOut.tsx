import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useApi } from './api/api';
import { usePending } from './outbox/Outbox';

/**
 * #95: "Sign out" on the main screen. It ends the session on the server, which needs a connection
 * (#95-4), then calls `onSignedOut`. Meals still waiting to be sent stay on the device, stamped
 * with their user, and go out when that user logs in again (#95-5), so the confirmation (#95-6)
 * only tells the user so.
 */
export function SignOut({ onSignedOut }: { onSignedOut: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const titleId = useId();
  // Not meals the server refused for good: those aren't waiting to be sent.
  const unsent = usePending({ unconfirmed: true }).filter((item) => item.refused === undefined);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const signOut = async () => {
    setConfirming(false);
    setBusy(true);
    setFailed(false);
    try {
      await api.logout();
      onSignedOut();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {failed && (
        <p role="alert" className="problem">
          {t('signOut.failed')}
        </p>
      )}
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() => (unsent.length > 0 ? setConfirming(true) : void signOut())}
      >
        {t('signOut.button')}
      </button>
      {confirming &&
        createPortal(
          <div className="overlay">
            <section role="dialog" aria-modal="true" aria-labelledby={titleId} className="dialog">
              <h1 id={titleId}>{t('signOut.confirmTitle')}</h1>
              <p>{t('signOut.unsent')}</p>
              <button
                type="button"
                className="secondary"
                autoFocus
                onClick={() => setConfirming(false)}
              >
                {t('signOut.cancel')}
              </button>
              <button type="button" className="primary" onClick={() => void signOut()}>
                {t('signOut.confirm')}
              </button>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
