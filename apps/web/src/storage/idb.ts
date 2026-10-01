// The app's IndexedDB database: the Direct Entry draft (M5-8) and the save outbox (M5-9).

const DB_NAME = 'macrofill';
/** 1: drafts. 2: outbox. Upgrades add the stores a database doesn't have yet. */
const DB_VERSION = 2;
export const STORES = ['drafts', 'outbox'] as const;
export type StoreName = (typeof STORES)[number];

export type Run = <T>(
  store: StoreName,
  mode: IDBTransactionMode,
  request: (store: IDBObjectStore) => IDBRequest<T>,
) => Promise<T>;

/**
 * Runs one request per transaction on the app's database, opened on first use. Rejects when
 * IndexedDB fails (blocked, full, unavailable); the next call tries to open it again.
 */
/**
 * IndexedDB can't be used at all here (no global, or opening is refused outright, as in some
 * private modes). Unlike a failed or blocked open, nothing can have been kept, or come back.
 */
export class IndexedDbUnavailable extends Error {}

/** Another tab holds an older version of the database open, so it can't be upgraded yet. */
export class IndexedDbBlocked extends Error {}

export function idb(factory: IDBFactory): Run {
  let db: Promise<IDBDatabase> | undefined;
  const open = () =>
    (db ??= new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(DB_NAME, DB_VERSION);
      } catch (error) {
        reject(new IndexedDbUnavailable('IndexedDB is unavailable', { cause: error }));
        return;
      }
      request.onupgradeneeded = () => {
        for (const name of STORES) {
          if (!request.result.objectStoreNames.contains(name)) {
            request.result.createObjectStore(name);
          }
        }
      };
      let blocked = false;
      request.onsuccess = () => {
        const database = request.result;
        // Opened after all, once the other tab let go: this attempt has failed already, so it
        // keeps nothing open. The next call opens it again.
        if (blocked) {
          database.close();
          return;
        }
        // A newer version in another tab (the next deploy) can't upgrade while this is open.
        database.onversionchange = () => {
          database.close();
          db = undefined;
        };
        resolve(database);
      };
      // Another tab holds an older version open: fail rather than wait for it to close.
      request.onblocked = () => {
        blocked = true;
        reject(new IndexedDbBlocked('IndexedDB is blocked by another tab'));
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB failed to open'));
    }));

  return async (name, mode, request) => {
    try {
      const database = await open();
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(name, mode);
        const done = request(transaction.objectStore(name));
        transaction.oncomplete = () => resolve(done.result);
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB aborted'));
      });
    } catch (error) {
      db = undefined;
      throw error;
    }
  };
}
