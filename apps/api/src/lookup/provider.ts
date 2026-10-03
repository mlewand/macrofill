import type { ProductCandidate } from '@macrofill/domain';

/** What one provider came to for one barcode (#66, #67). */
export type ProviderResult =
  | { result: 'hit'; candidate: ProductCandidate }
  | { result: 'miss' }
  /** It answered wrongly, or couldn't be reached or refused (e.g. rate limiting). */
  | { result: 'error' }
  | { result: 'timeout' };

/**
 * A public product database the app can ask by barcode. Adding a provider means implementing this
 * and listing it where the app is wired (`createLookupProviders`).
 */
export interface ProductLookupProvider {
  /** Stable name: it's the source of the products it finds, and shows in usage events. */
  readonly id: string;
  /**
   * Looks a barcode (the store's 13 digits) up. Never rejects: every way it can go wrong is a
   * result. Gives up on its own after its time, or when `signal` aborts.
   */
  lookup: (barcode: string, options?: { signal?: AbortSignal }) => Promise<ProviderResult>;
}
