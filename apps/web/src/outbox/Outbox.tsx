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
import { isOwnedBy, lastUser } from '../session';
import type { OutboxItem, OutboxStore } from './store';
import { syncOutbox } from './sync';

/**
 * `synced`: the server has the meal. `pending`: it's kept on the device and sent later (M5-9).
 * `refused`: the server refused it for good; it's kept on the device and listed as not saved.
 */
export type SaveResult = 'synced' | 'pending' | 'refused';

interface Outbox {
  /** Meals waiting to be sent, oldest first. */
  pending: OutboxItem[];
  /** Whether the server has confirmed who's logged in. */
  ready: boolean;
  /** Whether the server couldn't be asked (offline). */
  offline: boolean;
  save: (request: SaveMealRequest, entry: TodayEntry) => Promise<SaveResult>;
  /** Sends what's waiting, e.g. after logging in. */
  sync: () => Promise<void>;
  /** Removes a meal from the outbox: one the server refused, once the user has seen it. */
  remove: (mealId: string) => Promise<void>;
}

/** Where the outbox keeps meals. The default keeps nothing, so saves go straight to the server. */
export const OutboxStoreContext = createContext<OutboxStore | undefined>(undefined);

const OutboxContext = createContext<Outbox | undefined>(undefined);

/**
 * M5-9: saves go through an outbox on the device, so a meal saved offline isn't lost. What's
 * waiting is sent when the app starts, when the browser is back online, and on `sync()`.
 */
export function OutboxProvider({
  children,
  ready = true,
  offline = false,
}: {
  children: React.ReactNode;
  /**
   * Whether the server has confirmed who's logged in. Until then the remembered user may be stale:
   * no queued meal shows next to the server's day, and the startup sync waits.
   */
  ready?: boolean;
  /**
   * The server couldn't be asked who's logged in (offline): the remembered user's queued meals
   * may be listed on their own, where no server data is shown (`usePending({ unconfirmed })`).
   */
  offline?: boolean;
}) {
  const store = useContext(OutboxStoreContext);
  const api = useApi();
  const [pending, setPending] = useState<OutboxItem[]>([]);
  const running = useRef<Promise<void> | undefined>(undefined);
  const again = useRef(false);
  // Read by a sync in flight before each request: once unconfirmed, the rest waits.
  const readyRef = useRef(ready);
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);
  /** What became of each meal sent this session: saved, or refused for good. */
  const outcomes = useRef(new Map<string, 'synced' | 'dropped'>());

  /** The latest list; on a failed read, the last known one stays. */
  const refresh = useCallback(async () => {
    if (!store) return;
    try {
      setPending(await store.all());
    } catch {
      // Kept as it was: a read that fails doesn't mean nothing waits.
    }
  }, [store]);

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
        // Shown before they're sent, so Today sees them leave and loads the day again.
        await refresh();
        // A failed read stops the sync, and nothing waiting is taken for gone.
        const result = await syncOutbox(store, api, () =>
          readyRef.current ? lastUser() : undefined,
        ).catch(() => undefined);
        for (const id of result?.synced ?? []) outcomes.current.set(id, 'synced');
        for (const id of result?.dropped ?? []) outcomes.current.set(id, 'dropped');
        await refresh();
      } while (again.current);
    })();
    try {
      await running.current;
    } finally {
      running.current = undefined;
    }
  }, [store, api, refresh]);

  // What waits is listed from the start; it's sent once the server has confirmed the user.
  useEffect(() => {
    if (!store) return;
    let current = true;
    store.all().then(
      (items) => current && setPending(items),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [store]);
  useEffect(() => {
    if (!ready) return;
    void sync();
    const online = () => void sync();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [sync, ready]);

  const save = useCallback(
    async (request: SaveMealRequest, entry: TodayEntry): Promise<SaveResult> => {
      const id = request.meal.id;
      // Only a known owner sends and sees it (isOwnedBy): an ownerless meal would be stuck here.
      const username = request.username;
      if (username === undefined) throw new Error('A meal with no known owner is not saved.');
      try {
        if (!store) throw new Error('no outbox');
        // A new attempt: what became of an earlier one doesn't apply to it.
        outcomes.current.delete(id);
        // Stamped with the meal's own owner; who's logged in may have changed meanwhile.
        await store.add({ request, entry, queuedAt: new Date().toISOString(), username });
      } catch {
        // Nowhere to keep it: send it now, and let the caller report a failure.
        await api.saveMeal(request);
        return 'synced';
      }
      // A network that never answers (e.g. one that blocks the LAN) mustn't hold the screen: the
      // meal is safe in the outbox, and it's sent later.
      await settleWithin(sync(), SAVE_WAIT_MS, undefined);
      const outcome = outcomes.current.get(id);
      // Refused: kept in the outbox, marked, and listed in Today as not saved, like a refusal that
      // comes later; the summary can't fix it, so the flow ends and says so.
      if (outcome === 'dropped') return 'refused';
      return outcome === 'synced' ? 'synced' : 'pending';
    },
    [store, api, sync],
  );

  const remove = useCallback(
    async (mealId: string) => {
      if (!store) return;
      await store.remove(mealId).catch(() => undefined);
      await refresh();
    },
    [store, refresh],
  );

  const value = useMemo(
    () => ({ pending, ready, offline, save, sync, remove }),
    [pending, ready, offline, save, sync, remove],
  );
  return <OutboxContext value={value}>{children}</OutboxContext>;
}

/**
 * The current user's meals waiting to be sent; none outside an `OutboxProvider`, and none until
 * the server has confirmed the user. Filtered on every read, so another user's never show, not
 * even right after a switch.
 */
export function usePending(
  options: {
    /**
     * Also while the server hasn't confirmed the user: only where no server data is shown with
     * them (offline, when the day couldn't load), so the remembered user's meals can't mix in.
     */
    unconfirmed?: boolean;
  } = {},
): OutboxItem[] {
  const outbox = useContext(OutboxContext);
  if (!outbox) return [];
  // Unconfirmed, only when the server couldn't even be asked: never while it's being asked.
  if (!outbox.ready && !(options.unconfirmed && outbox.offline)) return [];
  const user = lastUser();
  return outbox.pending.filter((item) => isOwnedBy(item.username, user));
}

/**
 * Whether the server has confirmed who's logged in, and whether it couldn't be asked (offline).
 * Confirmed outside an `OutboxProvider`.
 */
export function useUserStatus(): { ready: boolean; offline: boolean } {
  const outbox = useContext(OutboxContext);
  return { ready: outbox?.ready ?? true, offline: outbox?.offline ?? false };
}

/** How long a save waits for the server before it reports the meal as pending. */
export const SAVE_WAIT_MS = 8000;

/** `promise`'s value, or `fallback` if it takes longer than `ms`. */
export function settleWithin<T, F>(promise: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<F>((resolve) => (timer = setTimeout(() => resolve(fallback), ms)));
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Removes a meal from the outbox; nothing outside an `OutboxProvider`. */
export function useRemovePending(): (mealId: string) => Promise<void> {
  return useContext(OutboxContext)?.remove ?? noRemove;
}

const noRemove = () => Promise.resolve();

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
