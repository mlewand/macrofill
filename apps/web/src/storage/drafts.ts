import {
  idSchema,
  recipeSchema,
  saveMealRequestSchema,
  timestampSchema,
  type SaveMealRequest,
} from '@macrofill/domain';
import { createContext, useContext } from 'react';
import { z } from 'zod';
import type { DirectEntryState } from '../directEntry/state';

/**
 * M5-8: the in-progress Direct Entry session, kept on the device so a page reload resumes it.
 * Loading never fails: no draft, a broken one or no IndexedDB all load as none.
 */
export interface DraftStore {
  load: () => Promise<Draft | undefined>;
  save: (draft: Draft) => Promise<void>;
  clear: () => Promise<void>;
}

export interface Draft {
  state: DirectEntryState;
  /**
   * The first save request sent, once there's one. It may have reached the server, so after a
   * reload the summary stays frozen and a retry resends exactly this (M4-6).
   */
  sent?: SaveMealRequest;
  /** Who was logged in when it was kept (see `session.ts`). */
  username?: string;
}

const stepDraftSchema = z.object({
  productId: idSchema.optional(),
  grams: z.string(),
  skipped: z.boolean(),
  fromScale: z.literal(true).optional(),
});

// Only Direct Entry sessions are kept; resuming Scale Mode is deferred (docs/TODO.md).
const draftSchema = z
  .object({
    recipe: recipeSchema,
    inputMethod: z.literal('direct'),
    mealId: idSchema,
    entryId: idSchema,
    startedAt: timestampSchema,
    steps: z.array(stepDraftSchema),
    current: z.number().int().nonnegative(),
  })
  .refine((d) => d.steps.length === d.recipe.steps.length && d.current <= d.steps.length);

const storedSchema = z
  .object({
    state: draftSchema,
    sent: saveMealRequestSchema.optional(),
    username: z.string().optional(),
  })
  .refine(
    ({ state, sent }) =>
      !sent || (sent.meal.id === state.mealId && sent.consumptionEntry.id === state.entryId),
  );

/** A stored value as a draft, or undefined if it isn't a valid one (e.g. from an older version). */
export function parseDraft(value: unknown): Draft | undefined {
  const result = storedSchema.safeParse(value);
  if (!result.success) return undefined;
  const { state, sent, username } = result.data;
  return {
    state: parseState(state),
    ...(sent ? { sent } : {}),
    ...(username === undefined ? {} : { username }),
  };
}

function parseState(state: z.infer<typeof draftSchema>): DirectEntryState {
  // The state keeps `productId` as an explicit key, and `fromScale` only when set.
  return {
    ...state,
    steps: state.steps.map(({ productId, grams, skipped, fromScale }) => ({
      productId,
      grams,
      skipped,
      ...(fromScale ? { fromScale } : {}),
    })),
  };
}

const DB_NAME = 'macrofill';
const DB_VERSION = 1;
const DRAFTS = 'drafts';
const KEY = 'directEntry';

/** The draft store on IndexedDB. Storage failures are swallowed: a draft is a convenience. */
export function indexedDbDraftStore(factory: IDBFactory = indexedDB): DraftStore {
  let db: Promise<IDBDatabase> | undefined;
  const open = () =>
    (db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => request.result.createObjectStore(DRAFTS);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB failed to open'));
    }));

  const run = async <T>(
    mode: IDBTransactionMode,
    request: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T | undefined> => {
    try {
      const database = await open();
      return await new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(DRAFTS, mode);
        const done = request(transaction.objectStore(DRAFTS));
        transaction.oncomplete = () => resolve(done.result);
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB aborted'));
      });
    } catch {
      db = undefined;
      return undefined;
    }
  };

  return {
    load: async () => parseDraft(await run('readonly', (store) => store.get(KEY))),
    save: async (draft) => {
      await run('readwrite', (store) => store.put(draft, KEY));
    },
    clear: async () => {
      await run('readwrite', (store) => store.delete(KEY));
    },
  };
}

/** Keeps nothing: the default, so components work without a provider. */
export const noDraftStore: DraftStore = {
  load: () => Promise.resolve(undefined),
  save: () => Promise.resolve(),
  clear: () => Promise.resolve(),
};

export const DraftContext = createContext<DraftStore>(noDraftStore);

export const useDraftStore = () => useContext(DraftContext);
