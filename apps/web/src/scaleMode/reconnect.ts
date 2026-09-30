import type { ReconnectSettings } from './settings';

export type ReconnectResult = 'connected' | 'gaveUp' | 'aborted';

/** How long to wait before attempt `n` (from 0): none for the first, then doubling to the maximum. */
export function retryDelay(n: number, settings: ReconnectSettings): number {
  if (n === 0) return 0;
  return Math.min(settings.firstDelayMs * 2 ** (n - 1), settings.maxDelayMs);
}

/**
 * M6-6: calls `connect` until it succeeds, waiting longer between attempts, until
 * `giveUpAfterMs` have passed since the start (the time attempts take counts) or `signal` aborts.
 */
export async function reconnect(
  connect: () => Promise<void>,
  settings: ReconnectSettings,
  signal: AbortSignal,
): Promise<ReconnectResult> {
  const start = Date.now();
  for (let n = 0; ; n++) {
    if (!(await wait(retryDelay(n, settings), signal))) return 'aborted';
    try {
      await connect();
      return signal.aborted ? 'aborted' : 'connected';
    } catch {
      if (signal.aborted) return 'aborted';
    }
    if (Date.now() - start >= settings.giveUpAfterMs) return 'gaveUp';
  }
}

/** Resolves true after `ms`, or false as soon as `signal` aborts. */
function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
