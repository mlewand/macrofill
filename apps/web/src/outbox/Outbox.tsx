import type { SaveMealRequest, TodayEntry } from '@macrofill/domain';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useApi } from '../api/api';
import { belongsToCurrentUser, lastUser } from '../session';
import type { OutboxItem, OutboxStore } from './store';
import { syncOutbox } from './sync';

/** `synced`: the server has the meal. `pending`: it's kept on the device and sent later (M5-9). */
export type SaveResult = 'synced' | 'pending';

interface Outbox {
  /** Meals waiting to be sent, oldest first. */
  pending: OutboxItem[];
  save: (request: SaveMealRequest, entry: TodayEntry) => Promise<SaveResult>;
  /** Sends what's waiting, e.g. after logging in. */
  sync: () => Promise<void>;
}

/** Where the outbox keeps meals. The default keeps nothing, so saves go straight to the server. */
export const OutboxStoreContext = createContext<OutboxStore | undefined>(undefined);

const OutboxContext = createContext<Outbox | undefined>(undefined);

/**
 * M5-9: saves go through an outbox on the device, so a meal saved offline isn't lost. What's
 * waiting is sent when the app starts, when the browser is back online, and on `sync()`.
 */
export function OutboxProvider({ children }: { children: React.ReactNode }) {
  const store = useContext(OutboxStoreContext);
  const api = useApi();
  const [pending, setPending] = useState<OutboxItem[]>([]);
  const running = useRef<Promise<void> | undefined>(undefined);
  const again = useRef(false);

  const sync = useCallback(async () => {
    if (!store) return;
    // One at a time; a request meanwhile runs once more after it.
    if (running.current) {
      again.current = true;
      return running.current;
    }
    running.current = (async () => {
      do {
        again.current = false;
        await syncOutbox(store, api, lastUser()).catch(() => undefined);
        // Only the current user's meals are theirs to see.
        setPending((await store.all()).filter((item) => belongsToCurrentUser(item.username)));
      } while (again.current);
    })();
    try {
      await running.current;
    } finally {
      running.current = undefined;
    }
  }, [store, api]);

  useEffect(() => {
    void sync();
    const online = () => void sync();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [sync]);

  const save = useCallback(
    async (request: SaveMealRequest, entry: TodayEntry): Promise<SaveResult> => {
      const id = request.meal.id;
      try {
        if (!store) throw new Error('no outbox');
        const username = lastUser();
        await store.add({
          request,
          entry,
          queuedAt: new Date().toISOString(),
          ...(username === undefined ? {} : { username }),
        });
      } catch {
        // Nowhere to keep it: send it now, and let the caller report a failure.
        await api.saveMeal(request);
        return 'synced';
      }
      await sync();
      return (await store.all()).some((item) => item.request.meal.id === id) ? 'pending' : 'synced';
    },
    [store, api, sync],
  );

  const value = useMemo(() => ({ pending, save, sync }), [pending, save, sync]);
  return <OutboxContext value={value}>{children}</OutboxContext>;
}

/** The meals waiting to be sent; none outside an `OutboxProvider`. */
export function usePending(): OutboxItem[] {
  return useContext(OutboxContext)?.pending ?? [];
}

/** Sends the outbox; nothing outside an `OutboxProvider`. */
export function useSync(): () => Promise<void> {
  return useContext(OutboxContext)?.sync ?? noSync;
}

const noSync = () => Promise.resolve();

/** Saves a meal: through the outbox, or straight to the server outside an `OutboxProvider`. */
export function useSaveMeal(): Outbox['save'] {
  const outbox = useContext(OutboxContext);
  const api = useApi();
  return (
    outbox?.save ??
    (async (request) => {
      await api.saveMeal(request);
      return 'synced';
    })
  );
}
