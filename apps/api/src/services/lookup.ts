import type { LookupAttempt, ProductCandidate } from '@macrofill/domain';
import type { ProductLookupProvider } from '../lookup/provider';

export interface LookupOutcome {
  candidate?: ProductCandidate;
  attempts: LookupAttempt[];
}

/**
 * #66-1: asks the providers about a barcode (the store's 13 digits) and says what each came to. A
 * provider that fails is an `error` here, never a failed request: the user gets the empty form.
 */
export async function lookupBarcode(
  providers: readonly ProductLookupProvider[],
  barcode: string,
): Promise<LookupOutcome> {
  const attempts: LookupAttempt[] = [];
  for (const provider of providers) {
    const outcome = await provider.lookup(barcode).catch(() => ({ result: 'error' as const }));
    attempts.push({ provider: provider.id, result: outcome.result });
    if (outcome.result === 'hit') return { candidate: outcome.candidate, attempts };
  }
  return { attempts };
}
