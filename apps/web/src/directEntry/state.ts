import { parseGrams, type Recipe, type SaveMealRequest } from '@macrofill/domain';

// Meal flow state (M5-1 to M5-6), shared by Direct Entry and Scale Mode (M6-4, M6-5). A pure
// reducer over plain JSON: no DOM, no clock, no randomness. Ids and times come in, so the state can
// be persisted as is (M5-8, Phase C).

export interface StepDraft {
  productId: string | undefined;
  /** The grams input as typed; parsed with `parseGrams` (M5-3). */
  grams: string;
  skipped: boolean;
  /** Set while `grams` is the amount the scale recorded; typed grams are manual (M6-5). */
  fromScale?: true;
  /**
   * Set while `productId` is a product of another ingredient class than the step's, picked on
   * purpose (#64-5). A kept session resumes with it; an unmarked one of another class is dropped.
   */
  otherClass?: true;
}

export interface DirectEntryState {
  recipe: Recipe;
  inputMethod: 'direct' | 'scale';
  /** Generated once per meal, so a retried save is idempotent (M4-6). */
  mealId: string;
  entryId: string;
  startedAt: string;
  /** One draft per recipe step. */
  steps: StepDraft[];
  /** Index of the current step; `steps.length` means the summary. */
  current: number;
}

export type DirectEntryAction =
  | { type: 'selectProduct'; productId: string; otherClass?: true }
  | { type: 'setGrams'; grams: string }
  /** Scale Mode: the tracker recorded the current step's amount (M6-4). */
  | { type: 'record'; grams: number }
  | { type: 'next' }
  | { type: 'skip' }
  | { type: 'undo' }
  | { type: 'editGrams'; index: number; grams: string };

export function startDirectEntry(input: {
  recipe: Recipe;
  /** Per step, the product the picker preselects (M5-2). */
  preselected: readonly (string | undefined)[];
  mealId: string;
  entryId: string;
  startedAt: string;
  /** Default `direct`. */
  inputMethod?: 'direct' | 'scale';
}): DirectEntryState {
  return {
    recipe: input.recipe,
    inputMethod: input.inputMethod ?? 'direct',
    mealId: input.mealId,
    entryId: input.entryId,
    startedAt: input.startedAt,
    steps: input.recipe.steps.map((_, i) => ({
      productId: input.preselected[i],
      grams: '',
      skipped: false,
    })),
    current: 0,
  };
}

export const isSummary = (state: DirectEntryState) => state.current >= state.steps.length;

/** Why a step can't be completed yet, or undefined if it can. */
export function stepProblem(
  step: StepDraft,
): 'product' | 'empty' | 'negative' | 'invalid' | undefined {
  if (step.productId === undefined) return 'product';
  const grams = parseGrams(step.grams);
  return grams.ok ? undefined : grams.reason;
}

export function directEntry(state: DirectEntryState, action: DirectEntryAction): DirectEntryState {
  const update = (index: number, change: Partial<StepDraft>): DirectEntryState => ({
    ...state,
    steps: state.steps.map((step, i) => (i === index ? { ...step, ...change } : step)),
  });
  const replace = (index: number, draft: StepDraft): DirectEntryState => ({
    ...state,
    steps: state.steps.map((step, i) => (i === index ? draft : step)),
  });
  const step = state.steps[state.current];

  switch (action.type) {
    case 'selectProduct': {
      if (!step) return state;
      // The mark belongs to the product picked, so it never carries over to another one.
      const next: StepDraft = { ...step, productId: action.productId };
      delete next.otherClass;
      if (action.otherClass) next.otherClass = true;
      return replace(state.current, next);
    }
    case 'setGrams':
      return step ? replace(state.current, typed(step, action.grams)) : state;
    case 'record': {
      if (!step) return state;
      const recorded: StepDraft = {
        productId: step.productId,
        grams: String(action.grams),
        skipped: false,
        fromScale: true,
        ...(step.otherClass ? { otherClass: true as const } : {}),
      };
      if (stepProblem(recorded) !== undefined) return state;
      return { ...replace(state.current, recorded), current: state.current + 1 };
    }
    case 'next':
      if (!step || stepProblem(step) !== undefined) return state;
      return { ...update(state.current, { skipped: false }), current: state.current + 1 };
    case 'skip':
      return step
        ? { ...update(state.current, { skipped: true }), current: state.current + 1 }
        : state;
    case 'undo': {
      // M5-5: back to the previous step, with what was entered there. A skipped step is un-skipped.
      if (state.current === 0) return state;
      const previous = state.current - 1;
      return { ...update(previous, { skipped: false }), current: previous };
    }
    case 'editGrams': {
      // M5-6: in the summary, any weighed item's grams can be edited.
      const target = state.steps[action.index];
      if (!isSummary(state) || !target || target.skipped) return state;
      return replace(action.index, typed(target, action.grams));
    }
  }
}

/**
 * The `POST /api/meals` body, or undefined while an item's grams are invalid. The ids come from
 * the state, so building it again for a retry gives the same meal and entry.
 */
export function saveRequest(state: DirectEntryState, now: string): SaveMealRequest | undefined {
  const items = mealItems(state);
  if (items === undefined) return undefined;
  return {
    meal: {
      id: state.mealId,
      recipeId: state.recipe.id,
      inputMethod: state.inputMethod,
      startedAt: state.startedAt,
      finishedAt: now,
      items,
    },
    consumptionEntry: { id: state.entryId, eatenAt: now, portion: { type: 'whole' } },
  };
}

/** The meal's items, or undefined while an item's grams are invalid. */
export function mealItems(state: DirectEntryState): SaveMealRequest['meal']['items'] | undefined {
  const items: SaveMealRequest['meal']['items'] = [];
  for (const [i, draft] of state.steps.entries()) {
    const stepId = state.recipe.steps[i]!.id;
    if (draft.skipped) {
      items.push({ stepId, skipped: true });
      continue;
    }
    const grams = parseGrams(draft.grams);
    if (draft.productId === undefined || !grams.ok) return undefined;
    items.push({
      stepId,
      skipped: false,
      productId: draft.productId,
      grams: grams.grams,
      weightSource: draft.fromScale ? 'scale' : 'manual',
    });
  }
  return items;
}

/** A draft with typed grams: no longer the scale's amount. */
function typed(step: StepDraft, grams: string): StepDraft {
  return {
    productId: step.productId,
    grams,
    skipped: step.skipped,
    ...(step.otherClass ? { otherClass: true as const } : {}),
  };
}
