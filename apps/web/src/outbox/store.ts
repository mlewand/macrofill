import {
  saveMealRequestSchema,
  todayEntrySchema,
  type SaveMealRequest,
  type TodayEntry,
} from '@macrofill/domain';
import { z } from 'zod';
import { idb } from '../storage/idb';

/** M5-9: a saved meal on its way to the server. */
export interface OutboxItem {
  request: SaveMealRequest;
  /** How Today shows it while it's pending, worked out when it was saved. */
  entry: TodayEntry;
  /** ISO time it was saved, for sending in order. */
  queuedAt: string;
}

const itemSchema = z.object({
  request: saveMealRequestSchema,
  entry: todayEntrySchema,
  queuedAt: z.iso.datetime(),
});

/** Where saved meals wait; kept by meal id, so saving the same meal twice keeps one. */
export interface OutboxStore {
  /** Rejects if the meal couldn't be kept (e.g. no IndexedDB): then it must be sent directly. */
  add: (item: OutboxItem) => Promise<void>;
  /** Oldest first. Items that don't parse (e.g. from another version) are left out. */
  all: () => Promise<OutboxItem[]>;
  remove: (mealId: string) => Promise<void>;
}

export function indexedDbOutbox(factory: IDBFactory = indexedDB): OutboxStore {
  const run = idb(factory);
  return {
    add: async (item) => {
      await run('outbox', 'readwrite', (store) => store.put(item, item.request.meal.id));
    },
    all: async () => {
      let values: unknown[];
      try {
        values = await run('outbox', 'readonly', (store) => store.getAll());
      } catch {
        return [];
      }
      return values
        .flatMap((value) => {
          const result = itemSchema.safeParse(value);
          return result.success ? [result.data as OutboxItem] : [];
        })
        .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
    },
    remove: async (mealId) => {
      await run('outbox', 'readwrite', (store) => store.delete(mealId));
    },
  };
}
