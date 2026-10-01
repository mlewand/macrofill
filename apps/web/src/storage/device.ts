import { indexedDbOutbox, type OutboxStore } from '../outbox/store';
import { indexedDbDraftStore, noDraftStore, type DraftStore } from './drafts';

/**
 * The stores on this device: the Direct Entry draft (M5-8) and the save outbox (M5-9). Without
 * IndexedDB the app still runs: nothing is kept, and saves go straight to the server.
 */
export function deviceStores(): { drafts: DraftStore; outbox: OutboxStore | undefined } {
  if (typeof indexedDB === 'undefined') return { drafts: noDraftStore, outbox: undefined };
  return { drafts: indexedDbDraftStore(indexedDB), outbox: indexedDbOutbox(indexedDB) };
}
