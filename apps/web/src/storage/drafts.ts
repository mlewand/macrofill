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
import { IndexedDbBlocked, IndexedDbUnavailable, idb } from './idb';

/**
 * M5-8: the in-progress Direct Entry session, kept on the device so a page reload resumes it.
 * Loading never fails: no draft, a broken one or no IndexedDB all load as none.
 */
export interface DraftStore {
  /** Undefined when there's none. Rejects only with `IndexedDbBlocked`: then try again later. */
  load: () => Promise<Draft | undefined>;
  /** Resolves whether the draft is kept: it never rejects, but a caller may need to know. */
  save: (draft: Draft) => Promise<boolean>;
  /** Resolves whether no draft is left. */
  clear: () => Promise<boolean>;
}

export interface Draft {
  state: DirectEntryState;
  /**
   * The first save request sent, once there's one. It may have reached the server, so after a
   * reload the summary stays frozen and a retry resends exactly this (M4-6).
   */
  sent?: SaveMealRequest;
  /**
   * Who was logged in when it was kept (see `session.ts`). A stored draft without it isn't valid:
   * a meal never starts without a known user, and one nobody owns must not be taken on by whoever
   * logs in next, e.g. after its deletion failed.
   */
  username: string;
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
    username: z.string().min(1),
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
    username,
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

const KEY = 'directEntry';

/** The draft store on IndexedDB. Never rejects: a draft is a convenience, but `save` and `clear`
 * say whether they worked, for a caller that must know. */
export function indexedDbDraftStore(factory: IDBFactory = indexedDB): DraftStore {
  const run = idb(factory);
  const attempt = async (work: () => Promise<unknown>): Promise<boolean> => {
    try {
      await work();
      return true;
    } catch (error) {
      // Unavailable: nothing is kept, and nothing can come back after a reload either.
      return error instanceof IndexedDbUnavailable;
    }
  };
  return {
    load: async () => {
      try {
        return parseDraft(
          await run('drafts', 'readonly', (store): IDBRequest<unknown> => store.get(KEY)),
        );
      } catch (error) {
        // Blocked: a kept session may well be there; the caller waits and tries again.
        if (error instanceof IndexedDbBlocked) throw error;
        return undefined;
      }
    },
    save: (draft) => attempt(() => run('drafts', 'readwrite', (store) => store.put(draft, KEY))),
    clear: () => attempt(() => run('drafts', 'readwrite', (store) => store.delete(KEY))),
  };
}

/** Keeps nothing: the default, so components work without a provider. */
export const noDraftStore: DraftStore = {
  load: () => Promise.resolve(undefined),
  save: () => Promise.resolve(true),
  clear: () => Promise.resolve(true),
};

export const DraftContext = createContext<DraftStore>(noDraftStore);

export const useDraftStore = () => useContext(DraftContext);
