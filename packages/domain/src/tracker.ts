// Weight tracker (M3-1 to M3-6, M3-14): turns scale readings and user events into step amounts.
// A pure reducer over plain JSON, with no timers: time comes only from reading timestamps, and a
// user event happens at the time of the latest reading.

/** A weight reading as the tracker sees it. */
export interface TimedReading {
  /** Absent while the scale shows a unit other than grams (M3-14). */
  grams?: number;
  /** Only when the scale reports it. */
  stable?: boolean;
  /** ms on a monotonic clock. */
  timestamp: number;
}

export interface TrackerConfig {
  /** M3-5: without the scale's flag, readings must stay within ± this many grams... */
  stabilityToleranceGrams: number;
  /** ...for this many ms. */
  stabilityWindowMs: number;
  /** M3-4: how long Next waits for a stable reading before proposing the last one. */
  stableWaitMs: number;
}

export const defaultTrackerConfig: TrackerConfig = {
  stabilityToleranceGrams: 1,
  stabilityWindowMs: 1000,
  stableWaitMs: 1500,
};

export type TrackerEvent =
  | { type: 'reading'; reading: TimedReading }
  /** M3-2: capture the baseline. Only on a stable reading. */
  | { type: 'start' }
  /** M3-3, M3-4: record the current step from the scale. */
  | { type: 'next' }
  /** M3-4: accept the proposed unstable reading. */
  | { type: 'confirm' }
  /** M3-6, M6-5: record the current step with typed grams. */
  | { type: 'correct'; grams: number }
  | { type: 'skip' }
  /** Back to the previous step, or to before Start from the first one. */
  | { type: 'undo' };

/**
 * A recorded step. `reading` is the scale's total when it was recorded; the next step counts from
 * it, also when the grams were typed.
 */
export type TrackedStep =
  | { skipped: true }
  | { skipped: false; grams: number; weightSource: 'scale' | 'manual'; reading: number };

/** Next was tapped and the current step isn't recorded yet. */
export type PendingNext =
  /** M3-4: waiting for a stable reading until `deadline`. */
  | { type: 'waiting'; deadline: number }
  /** M3-4: still unstable after the wait; the user confirms or corrects. */
  | { type: 'confirming'; reading: number; amount: number }
  /** M3-6: the amount would be below 0; the user corrects or undoes. */
  | { type: 'needsCorrection'; reading: number; amount: number };

export type TrackerStatus = 'idle' | 'measuring' | PendingNext['type'];

interface LatestReading {
  grams: number;
  timestamp: number;
  stable: boolean;
}

export interface TrackerState {
  config: TrackerConfig;
  /** Readings with grams that the software stability rule still needs, oldest first. */
  recent: { grams: number; timestamp: number }[];
  latest?: LatestReading;
  /** The reading at Start; undefined before Start. */
  baseline?: number | undefined;
  steps: TrackedStep[];
  pending?: PendingNext | undefined;
}

export function createTracker(config: Partial<TrackerConfig> = {}): TrackerState {
  return { config: { ...defaultTrackerConfig, ...config }, recent: [], steps: [] };
}

export function trackerStatus(state: TrackerState): TrackerStatus {
  if (state.baseline === undefined) return 'idle';
  return state.pending?.type ?? 'measuring';
}

/** M6-3: the amount added in the current step so far, or undefined before Start. */
export function currentAmount(state: TrackerState): number | undefined {
  const reference = referenceReading(state);
  if (reference === undefined || state.latest === undefined) return undefined;
  return state.latest.grams - reference;
}

/** The reading the current step counts from: the last recorded Next, or the baseline. */
function referenceReading(state: TrackerState): number | undefined {
  for (let i = state.steps.length - 1; i >= 0; i--) {
    const step = state.steps[i]!;
    if (!step.skipped) return step.reading;
  }
  return state.baseline;
}

export function track(state: TrackerState, event: TrackerEvent): TrackerState {
  if (event.type === 'reading') return onReading(state, event.reading);
  if (state.baseline === undefined) {
    return event.type === 'start' && state.latest?.stable
      ? { ...state, baseline: state.latest.grams }
      : state;
  }
  const { pending, latest } = state;

  switch (event.type) {
    case 'start':
      return state;
    case 'next':
      if (pending?.type === 'waiting' || pending?.type === 'needsCorrection' || !latest) {
        return state;
      }
      return latest.stable
        ? recordReading(state, latest.grams)
        : {
            ...state,
            pending: { type: 'waiting', deadline: latest.timestamp + state.config.stableWaitMs },
          };
    case 'confirm':
      return pending?.type === 'confirming' ? recordReading(state, pending.reading) : state;
    case 'correct': {
      if (!Number.isFinite(event.grams) || event.grams < 0) return state;
      const reading =
        pending?.type === 'confirming' || pending?.type === 'needsCorrection'
          ? pending.reading
          : latest?.grams;
      if (reading === undefined) return state;
      return record(state, { skipped: false, grams: event.grams, weightSource: 'manual', reading });
    }
    case 'skip':
      return record(state, { skipped: true });
    case 'undo':
      return state.steps.length === 0
        ? { ...state, pending: undefined, baseline: undefined }
        : { ...state, pending: undefined, steps: state.steps.slice(0, -1) };
  }
}

function onReading(state: TrackerState, reading: TimedReading): TrackerState {
  // M3-14: a reading without grams changes nothing.
  if (reading.grams === undefined) return state;
  const { stabilityToleranceGrams, stabilityWindowMs } = state.config;
  const grams = reading.grams;
  const timestamp = reading.timestamp;

  const recent = [...state.recent, { grams, timestamp }];
  // Keep the newest reading at or before the window's start, and everything after it.
  const windowStart = timestamp - stabilityWindowMs;
  let first = 0;
  for (let i = 0; i < recent.length; i++) if (recent[i]!.timestamp <= windowStart) first = i;
  const kept = recent.slice(first);

  // M3-5: the scale's flag when present. Otherwise the weight must have stayed within the
  // tolerance of this reading since at least the window's start.
  let stable = reading.stable;
  if (stable === undefined) {
    let since = timestamp;
    for (let i = kept.length - 1; i >= 0; i--) {
      if (Math.abs(kept[i]!.grams - grams) > stabilityToleranceGrams) break;
      since = kept[i]!.timestamp;
    }
    stable = since <= windowStart;
  }

  const next: TrackerState = { ...state, recent: kept, latest: { grams, timestamp, stable } };
  if (state.pending?.type !== 'waiting') return next;
  if (stable) return recordReading(next, grams);
  if (timestamp < state.pending.deadline) return next;
  const amount = grams - referenceReading(next)!;
  return { ...next, pending: { type: 'confirming', reading: grams, amount } };
}

/** Records the current step from a scale reading, unless its amount would be below 0 (M3-6). */
function recordReading(state: TrackerState, reading: number): TrackerState {
  const amount = reading - referenceReading(state)!;
  if (amount < 0) return { ...state, pending: { type: 'needsCorrection', reading, amount } };
  return record(state, { skipped: false, grams: amount, weightSource: 'scale', reading });
}

function record(state: TrackerState, step: TrackedStep): TrackerState {
  return { ...state, pending: undefined, steps: [...state.steps, step] };
}
