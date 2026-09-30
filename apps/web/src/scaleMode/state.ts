import {
  createTracker,
  parseGrams,
  track,
  type Recipe,
  type TimedReading,
  type TrackerConfig,
  type TrackerState,
} from '@macrofill/domain';
import { isWrongUnit } from '@macrofill/scale';
import {
  directEntry,
  isSummary,
  startDirectEntry,
  type DirectEntryAction,
  type DirectEntryState,
} from '../directEntry/state';

// Scale Mode state (M6-2 to M6-5, M6-10): the weight tracker from domain, driving the meal flow
// shared with Direct Entry. A pure reducer over plain JSON. Outside manual mode, the flow is always
// at the step the tracker is on: every tracker change, a reading included, is copied to the flow.

export interface ScaleModeState {
  flow: DirectEntryState;
  tracker: TrackerState;
  /** M6-10: the latest reading has no grams, because the scale shows another unit. */
  wrongUnit: boolean;
  /**
   * The scale dropped mid-meal. Phase B has no reconnect, so the rest of the meal takes typed grams
   * (M6-5), and the tracker is no longer used.
   */
  manual: boolean;
  /** Scale amounts are rounded to this, which only removes float noise from the subtraction. */
  resolutionGrams: number;
}

export type ScaleModeAction =
  | { type: 'reading'; reading: TimedReading }
  | { type: 'dropped' }
  | { type: 'start' }
  /** Also "read the scale again" from a proposal or a negative step. */
  | { type: 'next' }
  | { type: 'confirm' }
  /** Typed grams for the current step (M6-5). */
  | { type: 'correct'; grams: string }
  | { type: 'skip' }
  | { type: 'undo' }
  | { type: 'selectProduct'; productId: string }
  /** Manual mode only. */
  | { type: 'setGrams'; grams: string }
  /** Summary only (M6-5). */
  | { type: 'editGrams'; index: number; grams: string };

export function startScaleMode(input: {
  recipe: Recipe;
  preselected: readonly (string | undefined)[];
  mealId: string;
  entryId: string;
  startedAt: string;
  resolutionGrams: number;
  tracker?: Partial<TrackerConfig>;
}): ScaleModeState {
  return {
    flow: startDirectEntry({ ...input, inputMethod: 'scale' }),
    tracker: createTracker(input.tracker),
    wrongUnit: false,
    manual: false,
    resolutionGrams: input.resolutionGrams,
  };
}

/** M6-2: the scale is stable, shows grams and the session hasn't started. */
export function canStart(state: ScaleModeState): boolean {
  return (
    !state.manual &&
    !state.wrongUnit &&
    state.tracker.baseline === undefined &&
    state.tracker.latest?.stable === true
  );
}

/** Next can read the scale: started, grams shown, a product picked and nothing waiting. */
export function canNext(state: ScaleModeState): boolean {
  return (
    !state.manual &&
    !state.wrongUnit &&
    state.tracker.baseline !== undefined &&
    state.tracker.pending?.type !== 'waiting' &&
    hasProduct(state)
  );
}

/**
 * Typed grams can replace the current step's reading (M6-5). Not while the scale shows another
 * unit, unless a Next already captured its reading: the next step would count from a stale one.
 */
export function canCorrect(state: ScaleModeState): boolean {
  const pending = state.tracker.pending?.type;
  return (
    !state.manual &&
    state.tracker.baseline !== undefined &&
    hasProduct(state) &&
    (!state.wrongUnit || pending === 'confirming' || pending === 'needsCorrection')
  );
}

function hasProduct(state: ScaleModeState): boolean {
  return !isSummary(state.flow) && state.flow.steps[state.flow.current]?.productId !== undefined;
}

export function scaleMode(state: ScaleModeState, action: ScaleModeAction): ScaleModeState {
  const flow = (a: DirectEntryAction): ScaleModeState => ({
    ...state,
    flow: directEntry(state.flow, a),
  });

  if (state.manual) {
    switch (action.type) {
      case 'selectProduct':
      case 'setGrams':
      case 'next':
      case 'skip':
      case 'undo':
      case 'editGrams':
        return flow(action);
      default:
        return state;
    }
  }

  switch (action.type) {
    case 'reading': {
      const next = { ...state, wrongUnit: isWrongUnit(action.reading) };
      return tracked(next, { type: 'reading', reading: action.reading });
    }
    case 'dropped':
      return { ...state, manual: true };
    case 'start':
      return canStart(state) ? tracked(state, { type: 'start' }) : state;
    case 'next':
      return canNext(state) ? tracked(state, { type: 'next' }) : state;
    case 'confirm':
      return hasProduct(state) ? tracked(state, { type: 'confirm' }) : state;
    case 'correct': {
      const grams = parseGrams(action.grams);
      if (!grams.ok || !canCorrect(state)) return state;
      return tracked(state, { type: 'correct', grams: grams.grams });
    }
    case 'skip':
      return isSummary(state.flow) ? state : tracked(state, { type: 'skip' });
    case 'undo':
      // The tracker goes back a step, or to before Start from the first one; the flow follows.
      return {
        ...state,
        tracker: track(state.tracker, { type: 'undo' }),
        flow: directEntry(state.flow, { type: 'undo' }),
      };
    case 'selectProduct':
    case 'editGrams':
      return flow(action);
    case 'setGrams':
      return state;
  }
}

/** Applies a tracker event, then copies any newly recorded steps to the flow. */
function tracked(state: ScaleModeState, event: Parameters<typeof track>[1]): ScaleModeState {
  const tracker = track(state.tracker, event);
  let flow = state.flow;
  while (flow.current < tracker.steps.length) {
    const step = tracker.steps[flow.current]!;
    const before = flow.current;
    if (step.skipped) {
      flow = directEntry(flow, { type: 'skip' });
    } else if (step.weightSource === 'scale') {
      flow = directEntry(flow, { type: 'record', grams: round(step.grams, state.resolutionGrams) });
    } else {
      flow = directEntry(directEntry(flow, { type: 'setGrams', grams: String(step.grams) }), {
        type: 'next',
      });
    }
    // The flow refused the step. The gates above prevent it; don't loop on it.
    if (flow.current === before) return state;
  }
  return { ...state, tracker, flow };
}

/** To the scale's resolution, without float noise: 214.10000000000002 → 214.1. */
function round(grams: number, resolution: number): number {
  const decimals = Math.max(0, Math.ceil(-Math.log10(resolution)));
  return Number(grams.toFixed(decimals));
}
