import { describe, expect, it } from 'vitest';
import {
  createTracker,
  currentAmount,
  track,
  trackerStatus,
  type TimedReading,
  type TrackerEvent,
  type TrackerState,
} from '../src/index.js';

function reading(timestamp: number, grams: number | undefined, stable?: boolean): TrackerEvent {
  const timed: TimedReading = { timestamp };
  if (grams !== undefined) timed.grams = grams;
  if (stable !== undefined) timed.stable = stable;
  return { type: 'reading', reading: timed };
}
const start: TrackerEvent = { type: 'start' };
const next: TrackerEvent = { type: 'next' };
const confirm: TrackerEvent = { type: 'confirm' };
const skip: TrackerEvent = { type: 'skip' };
const undo: TrackerEvent = { type: 'undo' };
const correct = (grams: number): TrackerEvent => ({ type: 'correct', grams });

const run = (events: TrackerEvent[], state: TrackerState = createTracker()) =>
  events.reduce(track, state);

/** Stable readings with the scale's flag, 225 ms apart like the real scale. */
function stableAt(from: number, grams: number, count = 2): TrackerEvent[] {
  return Array.from({ length: count }, (_, i) => reading(from + i * 225, grams, true));
}

const amounts = (state: TrackerState) =>
  state.steps.map((step) => (step.skipped ? 'skipped' : step.grams));

describe('weight tracker', () => {
  it('M3-1: is a pure function of plain data, with no timers of its own', () => {
    const events = [...stableAt(0, 312), start, reading(500, 400, false), next];
    const once = run(events);
    expect(run(events)).toEqual(once);
    // Plain JSON: it survives a round trip unchanged.
    expect(JSON.parse(JSON.stringify(once))).toEqual(once);
    // Waiting for a stable reading ends only with a reading: no time passes without one.
    expect(trackerStatus(once)).toBe('waiting');
    expect(trackerStatus(track(once, reading(5000, 400, false)))).toBe('confirming');
  });

  describe('M3-2: baseline', () => {
    it('M3-2: Start captures the stable reading, so the bowl is never counted', () => {
      const state = run([...stableAt(0, 312), start, ...stableAt(1000, 526), next]);
      expect(state.baseline).toBe(312);
      expect(amounts(state)).toEqual([214]);
    });

    it('M3-2: Start does nothing while the reading is unstable or missing', () => {
      expect(trackerStatus(run([start]))).toBe('idle');
      expect(trackerStatus(run([reading(0, 312, false), start]))).toBe('idle');
      expect(trackerStatus(run([reading(0, 312, true), start]))).toBe('measuring');
    });
  });

  describe('M3-3: step amounts', () => {
    it('M3-3: each step is the reading at its Next minus the reading at the previous Next', () => {
      const state = run([
        ...stableAt(0, 312),
        start,
        ...stableAt(1000, 526),
        next,
        ...stableAt(2000, 544.5),
        next,
        ...stableAt(3000, 600),
        next,
      ]);
      const [first, second, third] = amounts(state);
      expect(first).toBe(214);
      expect(second).toBeCloseTo(18.5, 9);
      expect(third).toBeCloseTo(55.5, 9);
      expect(state.steps.every((s) => !s.skipped && s.weightSource === 'scale')).toBe(true);
    });

    it('M3-3: the live amount is the latest reading minus the previous Next', () => {
      const state = run([...stableAt(0, 312), start, ...stableAt(1000, 526), next]);
      expect(currentAmount(state)).toBe(0);
      expect(currentAmount(track(state, reading(2000, 540, false)))).toBe(14);
      expect(currentAmount(run([reading(0, 312, true)]))).toBeUndefined();
    });
  });

  describe('M3-4: Next on an unstable reading', () => {
    const tapped = [...stableAt(0, 312), start, reading(1000, 520, false), next];

    it('M3-4: waits, and records the first stable reading within 1.5 s', () => {
      const waiting = run(tapped);
      expect(trackerStatus(waiting)).toBe('waiting');
      expect(waiting.steps).toEqual([]);
      const done = run([reading(1225, 525, false), reading(1450, 526, true)], waiting);
      expect(trackerStatus(done)).toBe('measuring');
      expect(amounts(done)).toEqual([214]);
    });

    it('M3-4: still unstable after 1.5 s proposes the last reading, and records it on confirm', () => {
      const waiting = run([...tapped, reading(2000, 523, false), reading(2499, 524, false)]);
      expect(trackerStatus(waiting)).toBe('waiting');
      const proposed = track(waiting, reading(2500, 525, false));
      expect(trackerStatus(proposed)).toBe('confirming');
      expect(proposed.pending).toEqual({ type: 'confirming', reading: 525, amount: 213 });
      expect(proposed.steps).toEqual([]);
      const confirmed = track(proposed, confirm);
      expect(trackerStatus(confirmed)).toBe('measuring');
      expect(confirmed.steps).toEqual([
        { skipped: false, grams: 213, weightSource: 'scale', reading: 525 },
      ]);
    });

    it('M3-4: the wait is configurable', () => {
      const waiting = run(tapped, createTracker({ stableWaitMs: 300 }));
      expect(trackerStatus(track(waiting, reading(1300, 525, false)))).toBe('confirming');
    });

    it('M3-4: Next again while a proposal is shown waits again', () => {
      const proposed = run([...tapped, reading(2500, 525, false)]);
      const again = track(proposed, next);
      expect(trackerStatus(again)).toBe('waiting');
      expect(amounts(track(again, reading(2700, 526, true)))).toEqual([214]);
    });
  });

  describe('M3-5: stability', () => {
    it("M3-5: the scale's flag decides when there is one", () => {
      // Flagged stable while the value moves more than 1 g: stable.
      const flagged = run([reading(0, 312, true), reading(225, 316, true), start]);
      expect(flagged.baseline).toBe(316);
      // Flagged unstable although the value hasn't moved for 2 s: unstable.
      const unflagged = run([
        ...Array.from({ length: 10 }, (_, i) => reading(i * 225, 312, false)),
        start,
      ]);
      expect(trackerStatus(unflagged)).toBe('idle');
    });

    it('M3-5: without a flag, a reading is stable once readings stay within ±1 g of it for 1000 ms', () => {
      const early = run([reading(0, 312), reading(500, 312.4), reading(999, 311.5), start]);
      expect(trackerStatus(early)).toBe('idle');
      const settled = run([reading(0, 312), reading(500, 312.4), reading(1000, 311.5), start]);
      expect(settled.baseline).toBe(311.5);
    });

    it('M3-5: a reading outside ±1 g starts the 1000 ms over', () => {
      const moved = run([reading(0, 312), reading(500, 313.5), reading(1000, 313.5), start]);
      expect(trackerStatus(moved)).toBe('idle');
      expect(run([reading(1500, 313.5), start], moved).baseline).toBe(313.5);
    });

    it('M3-5: the tolerance and the window are configurable', () => {
      const config = createTracker({ stabilityToleranceGrams: 3, stabilityWindowMs: 400 });
      const state = run([reading(0, 312), reading(200, 312.5), reading(400, 310), start], config);
      expect(state.baseline).toBe(310);
      const strict = createTracker({ stabilityToleranceGrams: 0.5, stabilityWindowMs: 2000 });
      expect(trackerStatus(run([reading(0, 312), reading(1000, 312.6), start], strict))).toBe(
        'idle',
      );
    });

    it('M3-5, M3-14: without a flag, stability starts over after the scale shows another unit (regression: #29)', () => {
      const before = [reading(0, 312), reading(500, 312), reading(1000, 312)];
      const back = run([
        ...before,
        reading(1200, undefined),
        reading(2400, undefined),
        reading(2600, 312),
        start,
      ]);
      expect(trackerStatus(back)).toBe('idle');
      expect(run([reading(3100, 312), reading(3600, 312), start], back).baseline).toBe(312);
    });

    it('M3-5: without a flag, a gap in the readings longer than the window breaks stability (regression: #29)', () => {
      const gap = run([reading(0, 312), reading(1500, 312), start]);
      expect(trackerStatus(gap)).toBe('idle');
      expect(run([reading(2000, 312), reading(2500, 312), start], gap).baseline).toBe(312);
    });

    it('M3-5: a reading without the flag, from a scale that has one, falls back to the software rule', () => {
      const state = run([
        reading(0, 312, false),
        reading(225, 312),
        reading(700, 312.5),
        reading(1000, 312),
        start,
      ]);
      expect(state.baseline).toBe(312);
    });
  });

  describe('M3-6: negative step', () => {
    // A tare mid-meal: the scale reads 0 with the bowl and the first ingredient on it.
    const tared = [...stableAt(0, 312), start, ...stableAt(1000, 526), next, ...stableAt(2000, 0)];

    it('M3-6: a step below 0 is not recorded and asks for a correction', () => {
      const state = run([...tared, next]);
      expect(trackerStatus(state)).toBe('needsCorrection');
      expect(state.pending).toEqual({ type: 'needsCorrection', reading: 0, amount: -526 });
      expect(amounts(state)).toEqual([214]);
      // Confirm can't record it, and Next reading the same weight again asks again.
      expect(amounts(track(state, confirm))).toEqual([214]);
      const again = track(state, next);
      expect(trackerStatus(again)).toBe('needsCorrection');
      expect(amounts(again)).toEqual([214]);
    });

    it('M3-6: Next reads the scale again, e.g. once a lifted bowl is back', () => {
      const lifted = run([...stableAt(0, 312), start, ...stableAt(1000, 526), next]);
      const negative = run([...stableAt(2000, 0), next], lifted);
      expect(trackerStatus(negative)).toBe('needsCorrection');
      const waiting = run([reading(3000, 530, false), next], negative);
      expect(trackerStatus(waiting)).toBe('waiting');
      expect(amounts(run([reading(3225, 540, true)], waiting))).toEqual([214, 14]);
    });

    it('M3-6: an amount down to -0.3 g counts as 0, for the jitter of a stable scale (regression: #22)', () => {
      // The real scale flickers between 525.6 and 525.7 g while flagged stable.
      const started = [...stableAt(0, 525.7), start];
      const jitter = run([...started, ...stableAt(1000, 525.4)]);
      expect(currentAmount(jitter)).toBe(0);
      expect(track(jitter, next).steps).toEqual([
        { skipped: false, grams: 0, weightSource: 'scale', reading: 525.4 },
      ]);
      const below = run([...started, ...stableAt(1000, 525.3), next]);
      expect(trackerStatus(below)).toBe('needsCorrection');
      expect(currentAmount(below)).toBeCloseTo(-0.4, 9);
    });

    it('M3-6: the tolerance below 0 is configurable', () => {
      const strict = createTracker({ negativeToleranceGrams: 0 });
      const state = run([...stableAt(0, 525.7), start, ...stableAt(1000, 525.6), next], strict);
      expect(trackerStatus(state)).toBe('needsCorrection');
    });

    it('M3-4, M3-6: after the wait, a reading below the tolerance asks for a correction, not a confirmation', () => {
      const tapped = [...stableAt(0, 312), start, reading(1000, 311.8, false), next];
      expect(run([...tapped, reading(2500, 311.8, false)]).pending).toEqual({
        type: 'confirming',
        reading: 311.8,
        amount: 0,
      });
      expect(trackerStatus(run([...tapped, reading(2500, 300, false)]))).toBe('needsCorrection');
    });

    it('M3-6: a correction records the typed grams, and the next step counts from the tared reading', () => {
      const state = run([...tared, next, correct(18), ...stableAt(3000, 55), next]);
      expect(state.steps).toEqual([
        { skipped: false, grams: 214, weightSource: 'scale', reading: 526 },
        { skipped: false, grams: 18, weightSource: 'manual', reading: 0 },
        { skipped: false, grams: 55, weightSource: 'scale', reading: 55 },
      ]);
    });

    it('M3-6: undo returns to the previous step instead', () => {
      const state = run([...tared, next, undo]);
      expect(trackerStatus(state)).toBe('measuring');
      expect(amounts(state)).toEqual([]);
      expect(currentAmount(state)).toBe(-312);
    });
  });

  describe('M3-14: readings without grams', () => {
    it('M3-14: are ignored, except that the stability history starts over', () => {
      const before = run([...stableAt(0, 312), start, ...stableAt(1000, 526)]);
      const after = run([reading(1500, undefined, true), reading(1725, undefined, false)], before);
      expect({ ...after, recent: [] }).toEqual({ ...before, recent: [] });
      expect(after.recent).toEqual([]);
    });

    it('M3-14: never end a wait for a stable reading', () => {
      const waiting = run([...stableAt(0, 312), start, reading(1000, 520, false), next]);
      expect(trackerStatus(track(waiting, reading(9000, undefined, false)))).toBe('waiting');
    });
  });

  describe('skip, undo and correction', () => {
    const started = [...stableAt(0, 312), start];

    it('M3-3: skip records no amount, and the next step still counts from the previous Next', () => {
      const state = run([...started, skip, ...stableAt(1000, 526), next]);
      expect(state.steps).toEqual([
        { skipped: true },
        { skipped: false, grams: 214, weightSource: 'scale', reading: 526 },
      ]);
    });

    it('M3-3: skip drops a pending Next', () => {
      const state = run([...started, reading(1000, 300, true), next, skip]);
      expect(trackerStatus(state)).toBe('measuring');
      expect(amounts(state)).toEqual(['skipped']);
    });

    it('M3-3: undo removes the last step, and its amount is measured again from the reading before it', () => {
      const state = run([...started, ...stableAt(1000, 526), next, ...stableAt(2000, 544), next]);
      const undone = track(state, undo);
      expect(amounts(undone)).toEqual([214]);
      expect(currentAmount(undone)).toBe(18);
      expect(amounts(track(undone, next))).toEqual([214, 18]);
    });

    it('M3-2: undo at the first step goes back to before Start, so the baseline is taken again', () => {
      const state = run([...started, undo]);
      expect(trackerStatus(state)).toBe('idle');
      expect(state.baseline).toBeUndefined();
      expect(run([...stableAt(1000, 400), start], state).baseline).toBe(400);
      expect(run([undo])).toEqual(createTracker());
    });

    it('M6-5: a correction while measuring records the typed grams and counts on from the latest reading', () => {
      const state = run([
        ...started,
        reading(1000, 520, false),
        correct(200),
        ...stableAt(2000, 540),
      ]);
      expect(state.steps).toEqual([
        { skipped: false, grams: 200, weightSource: 'manual', reading: 520 },
      ]);
      expect(currentAmount(state)).toBe(20);
    });

    it('M3-4, M6-5: a correction replaces a proposal', () => {
      const proposed = run([
        ...started,
        reading(1000, 520, false),
        next,
        reading(2500, 525, false),
      ]);
      expect(run([correct(210)], proposed).steps).toEqual([
        { skipped: false, grams: 210, weightSource: 'manual', reading: 525 },
      ]);
    });

    it('M3-4, M6-5: a correction after the scale settles counts on from the settled reading (regression: #27)', () => {
      const proposed = run([
        ...started,
        reading(1000, 450, false),
        next,
        reading(2500, 450, false),
      ]);
      expect(trackerStatus(proposed)).toBe('confirming');
      const state = run([reading(2725, 412, true), correct(100)], proposed);
      expect(state.steps).toEqual([
        { skipped: false, grams: 100, weightSource: 'manual', reading: 412 },
      ]);
    });

    it('M2-2, M6-5: a correction must be a non-negative number', () => {
      const state = run([...started, ...stableAt(1000, 526)]);
      for (const grams of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(track(state, correct(grams))).toEqual(state);
      }
      expect(amounts(track(state, correct(0)))).toEqual([0]);
    });

    it('M3-2: does nothing before Start', () => {
      const idle = run([...stableAt(0, 312)]);
      for (const event of [next, confirm, skip, undo, correct(10)]) {
        expect(track(idle, event)).toEqual(idle);
      }
    });

    it('M3-2, M3-4: Start again, or Next while waiting, changes nothing', () => {
      const measuring = run([...started, ...stableAt(1000, 526)]);
      expect(track(measuring, start)).toEqual(measuring);
      const waiting = run([...started, reading(1000, 520, false), next]);
      expect(track(waiting, next)).toEqual(waiting);
    });

    it('M3-4: confirm does nothing without a proposal', () => {
      const state = run([...started, ...stableAt(1000, 526)]);
      expect(track(state, confirm)).toEqual(state);
    });
  });
});
