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
import { idb } from './idb';

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
  .object({ state: draftSchema, sent: saveMealRequestSchema.optional() })
  .refine(
    ({ state, sent }) =>
      !sent || (sent.meal.id === state.mealId && sent.consumptionEntry.id === state.entryId),
  );

/** A stored value as a draft, or undefined if it isn't a valid one (e.g. from an older version). */
export function parseDraft(value: unknown): Draft | undefined {
  const result = storedSchema.safeParse(value);
  if (!result.success) return undefined;
  const { state, sent } = result.data;
  return { state: parseState(state), ...(sent ? { sent } : {}) };
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

const KEY = 'directEntry';

/** The draft store on IndexedDB. Storage failures are swallowed: a draft is a convenience. */
export function indexedDbDraftStore(factory: IDBFactory = indexedDB): DraftStore {
  const run = idb(factory);
  const quietly = async <T>(work: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await work();
    } catch {
      return undefined;
    }
  };
  return {
    load: async () =>
      parseDraft(await quietly(() => run('drafts', 'readonly', (store) => store.get(KEY)))),
    save: async (draft) => {
      await quietly(() => run('drafts', 'readwrite', (store) => store.put(draft, KEY)));
    },
    clear: async () => {
      await quietly(() => run('drafts', 'readwrite', (store) => store.delete(KEY)));
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
