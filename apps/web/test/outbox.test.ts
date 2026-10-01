import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from '../src/api/api';
import { settleWithin } from '../src/outbox/Outbox';
import { indexedDbOutbox } from '../src/outbox/store';
import { syncOutbox } from '../src/outbox/sync';
import { indexedDbDraftStore } from '../src/storage/drafts';
import { stored } from './support/api';
import { outboxItem } from './support/outbox';

describe('outbox store (M5-9)', () => {
  it('M5-9: keeps saved meals by meal id, oldest first, until removed', async () => {
    const store = indexedDbOutbox(new IDBFactory());
    await store.add(outboxItem(2));
    await store.add(outboxItem(1));
    await store.add(outboxItem(1));
    expect((await store.all()).map((i) => i.request.meal.id)).toEqual([
      outboxItem(1).request.meal.id,
      outboxItem(2).request.meal.id,
    ]);
    await store.remove(outboxItem(1).request.meal.id);
    expect(await store.all()).toHaveLength(1);
  });

  it('M5-9: meals survive closing the app (a new connection)', async () => {
    const factory = new IDBFactory();
    await indexedDbOutbox(factory).add(outboxItem(1));
    expect(await indexedDbOutbox(factory).all()).toEqual([outboxItem(1)]);
  });

  it('M5-9, M5-8: a database from before the outbox keeps its draft and gets the outbox', async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve) => {
      const open = factory.open('macrofill', 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore('drafts').put({ kept: true }, 'directEntry');
      };
      open.onsuccess = () => {
        open.result.close();
        resolve();
      };
    });
    await indexedDbOutbox(factory).add(outboxItem(1));
    expect(await indexedDbOutbox(factory).all()).toHaveLength(1);
    // The old value isn't a valid draft, but it's still there to be read.
    await expect(indexedDbDraftStore(factory).load()).resolves.toBeUndefined();
  });

  it('M5-9: a database another tab keeps open fails instead of hanging (regression: #41)', async () => {
    const factory = new IDBFactory();
    // An older version of the app, open in another tab, that doesn't let go.
    await new Promise<void>((resolve) => {
      const open = factory.open('macrofill', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('drafts');
      open.onsuccess = () => resolve();
    });
    await expect(indexedDbOutbox(factory).add(outboxItem(1))).rejects.toThrow(/blocked/);
  });

  it('M5-9: adding fails loudly without IndexedDB, so the meal is sent directly', async () => {
    const broken = {
      open: () => {
        throw new Error('blocked');
      },
    } as unknown as IDBFactory;
    const store = indexedDbOutbox(broken);
    await expect(store.add(outboxItem(1))).rejects.toThrow('unavailable');
    await expect(store.all()).resolves.toEqual([]);
  });
});

describe('syncOutbox (M5-9)', () => {
  const api = (saveMeal: Api['saveMeal']) => ({ saveMeal: vi.fn(saveMeal) });

  it('M5-9, M4-6: sends the meals oldest first and removes each the server has', async () => {
    const store = indexedDbOutbox(new IDBFactory());
    await store.add(outboxItem(2));
    await store.add(outboxItem(1));
    const server = api((r) => Promise.resolve(stored(r)));
    expect(await syncOutbox(store, server, () => 'mlewand')).toEqual({
      synced: [outboxItem(1).request.meal.id, outboxItem(2).request.meal.id],
      dropped: [],
    });
    expect(server.saveMeal.mock.calls.map(([r]) => r)).toEqual([
      outboxItem(1).request,
      outboxItem(2).request,
    ]);
    expect(await store.all()).toEqual([]);
  });

  it('M5-9: without a connection, everything stays for the next try', async () => {
    const store = indexedDbOutbox(new IDBFactory());
    await store.add(outboxItem(1));
    await store.add(outboxItem(2));
    const offline = api(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await syncOutbox(store, offline, () => 'mlewand')).toMatchObject({
      stopped: 'unreachable',
    });
    expect(offline.saveMeal).toHaveBeenCalledTimes(1);
    expect(await store.all()).toHaveLength(2);
    const failing = api(() => Promise.reject(new ApiError(503)));
    expect(await syncOutbox(store, failing, () => 'mlewand')).toMatchObject({
      stopped: 'unreachable',
    });
    expect(await store.all()).toHaveLength(2);
  });

  it('M5-9: without a session, meals wait for a login', async () => {
    const store = indexedDbOutbox(new IDBFactory());
    await store.add(outboxItem(1));
    expect(
      await syncOutbox(
        store,
        api(() => Promise.reject(new ApiError(401))),
        () => 'mlewand',
      ),
    ).toEqual({
      synced: [],
      dropped: [],
      stopped: 'unauthorized',
    });
    expect(await store.all()).toHaveLength(1);
  });

  it("M5-9: only the current user's meals are sent; another user's wait for them", async () => {
    const store = indexedDbOutbox(new IDBFactory());
    await store.add({ ...outboxItem(1), username: 'other' });
    await store.add({ ...outboxItem(2), username: 'mlewand' });
    const unstamped = outboxItem(3);
    delete unstamped.username;
    await store.add(unstamped);
    const server = api((r) => Promise.resolve(stored(r)));
    expect(await syncOutbox(store, server, () => 'mlewand')).toEqual({
      // Not the unstamped one: a meal with no known owner is nobody's to send.
      synced: [outboxItem(2).request.meal.id],
      dropped: [],
    });
    expect((await store.all()).map((i) => i.username)).toEqual(['other', undefined]);
  });

  it.each([400, 404, 409, 422])(
    'M5-9: a meal refused with %i stays on the device, marked refused, and is not sent again (regression: #41)',
    async (status) => {
      const store = indexedDbOutbox(new IDBFactory());
      await store.add(outboxItem(1));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => 'mlewand');
      const server = api(() => Promise.reject(new ApiError(status)));
      const result = await syncOutbox(store, server, () => 'mlewand');
      expect(result.dropped).toEqual([outboxItem(1).request.meal.id]);
      expect(await store.all()).toEqual([{ ...outboxItem(1), refused: status }]);
      await syncOutbox(store, server, () => 'mlewand');
      expect(server.saveMeal).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    },
  );

  it('M5-9: a meal deleted meanwhile (410) was saved already: it counts as synced and leaves the outbox (regression: #41)', async () => {
    const store = indexedDbOutbox(new IDBFactory());
    await store.add(outboxItem(1));
    const result = await syncOutbox(
      store,
      api(() => Promise.reject(new ApiError(410))),
      () => 'mlewand',
    );
    expect(result).toEqual({ synced: [outboxItem(1).request.meal.id], dropped: [] });
    expect(await store.all()).toEqual([]);
  });

  it('M5-9: a meal refused for another user (403) waits for them, and the rest go on (regression: #41)', async () => {
    const store = indexedDbOutbox(new IDBFactory());
    await store.add(outboxItem(1));
    await store.add(outboxItem(2));
    const server = api((r) =>
      r.meal.id === outboxItem(1).request.meal.id
        ? Promise.reject(new ApiError(403))
        : Promise.resolve(stored(r)),
    );
    const result = await syncOutbox(store, server, () => 'mlewand');
    expect(result).toEqual({ synced: [outboxItem(2).request.meal.id], dropped: [] });
    expect(await store.all()).toEqual([outboxItem(1)]);
  });

  it('M5-9: with no known user, nothing is sent (regression: #41)', async () => {
    const store = indexedDbOutbox(new IDBFactory());
    await store.add(outboxItem(1));
    const server = api((r) => Promise.resolve(stored(r)));
    expect(await syncOutbox(store, server, () => undefined)).toEqual({ synced: [], dropped: [] });
    expect(server.saveMeal).not.toHaveBeenCalled();
    expect(await store.all()).toHaveLength(1);
  });

  it('M5-9: when another user logs in mid-sync, the rest of the backlog waits (regression: #41)', async () => {
    const store = indexedDbOutbox(new IDBFactory());
    await store.add({ ...outboxItem(1), username: 'mlewand' });
    await store.add({ ...outboxItem(2), username: 'mlewand' });
    let user = 'mlewand';
    const server = api((r) => {
      user = 'other';
      return Promise.resolve(stored(r));
    });
    const result = await syncOutbox(store, server, () => user);
    expect(result.synced).toEqual([outboxItem(1).request.meal.id]);
    expect(server.saveMeal).toHaveBeenCalledTimes(1);
    expect(await store.all()).toHaveLength(1);
  });

  it('M5-9: a meal the server refuses for good stays marked, and the rest go on', async () => {
    const store = indexedDbOutbox(new IDBFactory());
    await store.add(outboxItem(1));
    await store.add(outboxItem(2));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => 'mlewand');
    const server = api((r) =>
      r.meal.id === outboxItem(1).request.meal.id
        ? Promise.reject(new ApiError(409))
        : Promise.resolve(stored(r)),
    );
    expect(await syncOutbox(store, server, () => 'mlewand')).toEqual({
      synced: [outboxItem(2).request.meal.id],
      dropped: [outboxItem(1).request.meal.id],
    });
    expect(await store.all()).toEqual([{ ...outboxItem(1), refused: 409 }]);
    warn.mockRestore();
  });
});

describe('settleWithin (M5-9)', () => {
  it('M5-9: a save stops waiting for the network after a while (regression: #41)', async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<string>(() => 'mlewand');
      const result = settleWithin(never, 1000, 'timeout');
      await vi.advanceTimersByTimeAsync(1000);
      expect(await result).toBe('timeout');
      await expect(settleWithin(Promise.resolve('done'), 1000, 'timeout')).resolves.toBe('done');
    } finally {
      vi.useRealTimers();
    }
  });
});
