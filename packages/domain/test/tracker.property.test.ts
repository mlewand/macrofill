import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createTracker,
  track,
  trackerStatus,
  type TrackerEvent,
  type TrackerState,
} from '../src/index.js';

/** One thing the user does between two Nexts. */
type Action =
  | { type: 'weigh'; addedTenths: number; noise: number[]; flagged: boolean }
  | { type: 'skip' }
  | { type: 'undoAndRedo' };

// Grams in tenths, like the scale's 0.1 g resolution.
const action: fc.Arbitrary<Action> = fc.oneof(
  {
    arbitrary: fc.record({
      type: fc.constant('weigh' as const),
      addedTenths: fc.integer({ min: 0, max: 5000 }),
      // Unstable readings while pouring or pressing with a spoon: any value, even below the bowl.
      noise: fc.array(fc.integer({ min: 0, max: 20000 }), { maxLength: 4 }),
      flagged: fc.boolean(),
    }),
    weight: 4,
  },
  { arbitrary: fc.constant({ type: 'skip' } as const), weight: 1 },
  { arbitrary: fc.constant({ type: 'undoAndRedo' } as const), weight: 1 },
);

/**
 * Plays a meal with non-decreasing stable readings and no manual corrections. Returns the final
 * state and the reading at the last recorded Next (the baseline if there's none).
 */
function play(baselineTenths: number, actions: Action[]) {
  let state: TrackerState = createTracker();
  let time = 0;
  let grams = baselineTenths / 10;
  const feed = (event: TrackerEvent) => {
    state = track(state, event);
  };
  const reading = (value: number, stable?: boolean) => {
    time += 225;
    feed({
      type: 'reading',
      reading:
        stable === undefined
          ? { timestamp: time, grams: value }
          : { timestamp: time, grams: value, stable },
    });
  };
  // Holds the weight until it's stable: flagged by the scale, or ±1 g for 1000 ms.
  const settle = (flagged: boolean) => {
    if (flagged) reading(grams, true);
    else for (let i = 0; i < 6; i++) reading(grams);
  };

  settle(true);
  feed({ type: 'start' });
  // The reading at each recorded Next, in step order; skipped steps have none.
  const nextReadings: (number | undefined)[] = [];
  for (const a of actions) {
    switch (a.type) {
      case 'weigh':
        for (const n of a.noise) reading(n / 10, a.flagged ? false : undefined);
        grams += a.addedTenths / 10;
        settle(a.flagged);
        feed({ type: 'next' });
        nextReadings.push(grams);
        break;
      case 'skip':
        feed({ type: 'skip' });
        nextReadings.push(undefined);
        break;
      case 'undoAndRedo': {
        if (nextReadings.length === 0) break;
        feed({ type: 'undo' });
        const undone = nextReadings.pop();
        if (undone === undefined) {
          feed({ type: 'skip' });
        } else {
          // The ingredient is still in the bowl: Next again reads the same total.
          feed({ type: 'next' });
        }
        nextReadings.push(undone === undefined ? undefined : grams);
        break;
      }
    }
  }
  const recorded = nextReadings.filter((r) => r !== undefined);
  return { state, lastNext: recorded.at(-1) ?? baselineTenths / 10 };
}

describe('weight tracker properties', () => {
  it('M3-10: with no corrections and non-decreasing stable readings, the step amounts add up to the last Next minus the baseline', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20000 }),
        fc.array(action, { maxLength: 12 }),
        (baselineTenths, actions) => {
          const { state, lastNext } = play(baselineTenths, actions);
          expect(trackerStatus(state)).toBe('measuring');
          const weighed = state.steps.filter((s) => !s.skipped);
          expect(weighed.every((s) => s.weightSource === 'scale' && s.grams >= 0)).toBe(true);
          const sum = weighed.reduce((total, s) => total + s.grams, 0);
          expect(sum).toBeCloseTo(lastNext - baselineTenths / 10, 6);
        },
      ),
    );
  });
});
