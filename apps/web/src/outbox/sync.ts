import { ApiError, type Api } from '../api/api';
import { belongsTo } from '../session';
import type { OutboxStore } from './store';

export interface SyncResult {
  /** Meal ids the server has now. */
  synced: string[];
  /** Meal ids the server refused for good (invalid, conflicting or deleted meanwhile). */
  dropped: string[];
  /** Why items are left: no session (they wait for a login), or no connection. */
  stopped?: 'unauthorized' | 'unreachable';
}

/**
 * Statuses that a retry can't change: such a meal leaves the outbox. 404: an id belongs to another
 * user (M4-3).
 */
const FINAL = new Set([400, 404, 409, 410, 422]);

/**
 * M5-9: sends the current user's meals in the outbox, oldest first, removing each the server accepts. Retries never
 * duplicate a meal (M4-6). Stops at the first meal that can't be sent now, leaving it and the rest.
 */
export async function syncOutbox(
  store: OutboxStore,
  api: Pick<Api, 'saveMeal'>,
  /** The current user (`lastUser()`): another user's meals wait for them. */
  user: string | undefined,
): Promise<SyncResult> {
  const result: SyncResult = { synced: [], dropped: [] };
  for (const item of await store.all()) {
    if (!belongsTo(item.username, user)) continue;
    const id = item.request.meal.id;
    try {
      await api.saveMeal(item.request);
      result.synced.push(id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        result.stopped = 'unauthorized';
        return result;
      }
      if (!(error instanceof ApiError && FINAL.has(error.status))) {
        result.stopped = 'unreachable';
        return result;
      }
      console.warn(`Meal ${id} was refused (${error.status}) and is dropped.`);
      result.dropped.push(id);
    }
    await store.remove(id);
  }
  return result;
}
