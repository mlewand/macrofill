import { ApiError, type Api } from '../api/api';
import { isOwnedBy } from '../session';
import type { OutboxStore } from './store';

export interface SyncResult {
  /** Meal ids the server has now. */
  synced: string[];
  /** Meal ids the server refused for good (invalid, or an id that's taken). */
  dropped: string[];
  /** Why items are left: no session (they wait for a login), or no connection. */
  stopped?: 'unauthorized' | 'unreachable';
}

/**
 * Statuses that a retry can't change. Such a meal stays on the device, marked refused, so it's
 * never lost silently; the user removes it. 404: an id belongs to another user (M4-3).
 */
const REFUSED = new Set([400, 404, 409, 422]);

/** 410: the meal was saved, and its entry deleted since (M7-4). Nothing is lost by dropping it. */
const GONE = 410;

/**
 * M5-9: sends the current user's meals in the outbox, oldest first, removing each the server
 * accepts. Retries never duplicate a meal (M4-6). Stops at the first meal that can't be sent now,
 * leaving it and the rest.
 */
export async function syncOutbox(
  store: OutboxStore,
  api: Pick<Api, 'saveMeal'>,
  /**
   * Who's logged in now (`lastUser`), read before every request: if another tab logs in as someone
   * else mid-sync, the rest of the backlog waits for its owner.
   */
  currentUser: () => string | undefined,
): Promise<SyncResult> {
  const result: SyncResult = { synced: [], dropped: [] };
  for (const item of await store.all()) {
    if (item.refused !== undefined || !isOwnedBy(item.username, currentUser())) continue;
    const id = item.request.meal.id;
    try {
      await api.saveMeal(item.request);
      result.synced.push(id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        result.stopped = 'unauthorized';
        return result;
      }
      // 403: the meal names another user than the session's (M4-1). It waits for its owner.
      if (error instanceof ApiError && error.status === 403) continue;
      if (error instanceof ApiError && REFUSED.has(error.status)) {
        console.warn(`Meal ${id} was refused (${error.status}); it's kept, marked refused.`);
        result.dropped.push(id);
        await store.add({ ...item, refused: error.status });
        continue;
      }
      if (!(error instanceof ApiError && error.status === GONE)) {
        result.stopped = 'unreachable';
        return result;
      }
      // Saved before (its entry deleted since): as good as synced for whoever saved it.
      result.synced.push(id);
    }
    await store.remove(id);
  }
  return result;
}
