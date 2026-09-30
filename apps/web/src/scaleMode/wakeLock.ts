import { useEffect } from 'react';

/**
 * M6-9: holds a screen wake lock while `active`, so the screen turning off doesn't suspend the page
 * and drop the scale's stream. The browser releases the lock when the page is hidden, so it's
 * requested again when the page is visible again. Failures are ignored: the session goes on.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    let ended = false;

    const request = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock.request('screen').then(
        (sentinel) => {
          if (ended) void sentinel.release().catch(() => undefined);
          else lock = sentinel;
        },
        () => undefined,
      );
    };
    const onVisibility = () => request();

    request();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      ended = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}
