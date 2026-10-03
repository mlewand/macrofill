import type { LookupAttempt, ProductCandidate } from '@macrofill/domain';
import type { ProductLookupProvider } from '../lookup/provider';

export interface LookupOutcome {
  candidate?: ProductCandidate;
  attempts: LookupAttempt[];
}

/** How long the whole lookup may take, all providers together (#67-2). */
export const DEFAULT_TOTAL_TIMEOUT_MS = 10_000;

/**
 * #66-1, #67-1, #67-2: asks the providers about a barcode (the store's 13 digits) in order, until
 * one has it, and says what each came to. A provider that has no answer, fails or times out passes
 * to the next; one that throws is an `error`, never a failed request. When the total time runs out
 * the provider being asked is told to stop (it reports a timeout) and the rest aren't asked: the
 * user gets the empty form.
 */
export async function lookupBarcode(
  providers: readonly ProductLookupProvider[],
  barcode: string,
  { totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS }: { totalTimeoutMs?: number } = {},
): Promise<LookupOutcome> {
  const total = new AbortController();
  const timer = setTimeout(() => total.abort(), totalTimeoutMs);
  const attempts: LookupAttempt[] = [];
  try {
    for (const provider of providers) {
      if (total.signal.aborted) break;
      const outcome = await provider
        .lookup(barcode, { signal: total.signal })
        .catch(() => ({ result: 'error' as const }));
      attempts.push({ provider: provider.id, result: outcome.result });
      if (outcome.result === 'hit') return { candidate: outcome.candidate, attempts };
    }
    return { attempts };
  } finally {
    clearTimeout(timer);
  }
}
