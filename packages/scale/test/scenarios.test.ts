import {
  createTracker,
  currentAmount,
  track,
  trackerStatus,
  type TimedReading,
  type TrackerState,
} from '@macrofill/domain';
import { describe, expect, it } from 'vitest';
import { scaleScript } from '../src/index.js';

// M3-12: the builder's output fed to the tracker, as a session plays out.
const feed = (state: TrackerState, readings: TimedReading[]) =>
  readings.reduce((s, reading) => track(s, { type: 'reading', reading }), state);
const tap = (state: TrackerState, type: 'start' | 'next' | 'confirm' | 'skip' | 'undo') =>
  track(state, { type });
const amounts = (state: TrackerState) =>
  state.steps.map((s) => (s.skipped ? 'skipped' : [s.grams, s.weightSource]));

describe('tracker scenarios from scaleScript()', () => {
  it('M3-12: a full meal: bowl, three ingredients and a skip', () => {
    const script = scaleScript().baseline(312);
    let state = tap(feed(createTracker(), script.take()), 'start');
    state = tap(feed(state, script.add(214, { overMs: 3000 }).stable().take()), 'next');
    state = tap(state, 'skip');
    state = tap(feed(state, script.add(18.5, { overMs: 1000 }).stable().take()), 'next');
    state = tap(feed(state, script.add(40).stable().take()), 'next');
    expect(state.baseline).toBe(312);
    expect(amounts(state)).toEqual([
      [214, 'scale'],
      'skipped',
      [expect.closeTo(18.5, 9), 'scale'],
      [40, 'scale'],
    ]);
  });

  it('M3-12, M3-5: the same meal on a scale without a stable flag', () => {
    const script = scaleScript({ stableFlag: false }).baseline(312);
    let state = tap(feed(createTracker(), script.take()), 'start');
    state = tap(feed(state, script.add(214, { overMs: 3000 }).stable().take()), 'next');
    expect(amounts(state)).toEqual([[214, 'scale']]);
  });

  it('M3-12, M3-4: Next while pouring waits, and records once the scale settles', () => {
    const script = scaleScript().baseline(312);
    let state = tap(feed(createTracker(), script.take()), 'start');
    state = tap(feed(state, script.add(200, { overMs: 1000 }).take()), 'next');
    expect(trackerStatus(state)).toBe('waiting');
    state = feed(state, script.add(14, { overMs: 450 }).stable().take());
    expect(amounts(state)).toEqual([[214, 'scale']]);
  });

  it('M3-12, M3-4: a scale that never settles gets its last reading proposed', () => {
    const script = scaleScript().baseline(312);
    let state = tap(feed(createTracker(), script.take()), 'start');
    state = tap(feed(state, script.add(214).take()), 'next');
    state = feed(state, script.unstable({ forMs: 2000 }).take());
    expect(state.pending).toEqual({ type: 'confirming', reading: 526, amount: 214 });
  });

  it('M3-12, M3-6: a tare mid-meal asks for a correction', () => {
    const script = scaleScript().baseline(312);
    let state = tap(feed(createTracker(), script.take()), 'start');
    state = tap(feed(state, script.add(214).stable().take()), 'next');
    // Tared with the curd on, then 18 g of milk: Next reads 18 g, below the 526 g before.
    state = tap(feed(state, script.tare().stable().add(18).stable().take()), 'next');
    expect(trackerStatus(state)).toBe('needsCorrection');
    state = track(state, { type: 'correct', grams: 20 });
    state = tap(feed(state, script.add(55).stable().take()), 'next');
    expect(amounts(state)).toEqual([
      [214, 'scale'],
      [20, 'manual'],
      [55, 'scale'],
    ]);
  });

  it('M3-12, M3-14: wrong-unit readings are ignored, so the last grams reading stays the latest', () => {
    const script = scaleScript().baseline(312);
    let state = tap(feed(createTracker(), script.take()), 'start');
    state = feed(state, script.add(214).stable().take());
    const before = state;
    state = feed(state, script.wrongUnit({ forMs: 2000 }).take());
    expect(state).toEqual(before);
    // The tracker would still record from the stale reading: the UI disables Next (M6-10).
    expect(currentAmount(state)).toBe(214);
  });
});
