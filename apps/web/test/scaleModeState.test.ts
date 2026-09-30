import { saveMealRequestSchema, type Recipe } from '@macrofill/domain';
import { scaleScript } from '@macrofill/scale';
import { describe, expect, it } from 'vitest';
import { isSummary, saveRequest } from '../src/directEntry/state';
import {
  canNext,
  canStart,
  scaleMode,
  startScaleMode,
  type ScaleModeAction,
  type ScaleModeState,
} from '../src/scaleMode/state';

const recipe: Recipe = {
  id: '9a13c2a4-8d6e-401e-aeb3-deb367561938',
  name: { en: 'Curd' },
  steps: [
    { id: 'a6b75d73-d68a-4eec-8219-5a16aeb9917e', ingredientClassId: 'curd' },
    { id: 'b48924bb-4fa3-4843-b727-6928f03636d0', ingredientClassId: 'milk' },
    { id: '093be00d-6f5c-4559-8b47-2c5d66b50aca', ingredientClassId: 'cucumber' },
  ],
};
const curd = '033ee3fe-72a7-409c-8dc3-76626baa14db';
const milk = '2fb48689-9acc-4a8a-9b1f-f0bf8e44b474';
const cucumber = '783cae78-b76f-45a1-b43d-254cfcef6014';

const start = (preselected: (string | undefined)[] = [curd, milk, cucumber]) =>
  startScaleMode({
    recipe,
    preselected,
    mealId: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
    entryId: 'c8f4d2b3-5e6a-4f7b-8c9d-8e7f6a5b4c3d',
    startedAt: '2026-01-15T07:00:00.000Z',
    resolutionGrams: 0.1,
  });

const apply = (state: ScaleModeState, ...actions: ScaleModeAction[]) =>
  actions.reduce(scaleMode, state);
const play = (
  state: ScaleModeState,
  readings: ReturnType<ReturnType<typeof scaleScript>['take']>,
) => apply(state, ...readings.map((reading) => ({ type: 'reading', reading }) as const));

/** Outside manual mode, the flow is always at the step the tracker is on. */
function expectInStep(state: ScaleModeState) {
  expect(state.flow.current).toBe(state.tracker.steps.length);
}

const grams = (state: ScaleModeState) => state.flow.steps.map((s) => (s.skipped ? '-' : s.grams));

describe('Scale Mode state', () => {
  it('M6-2: Start needs a stable reading, and captures the baseline', () => {
    const script = scaleScript().baseline(312);
    let state = play(start(), scaleScript().baseline(312).unstable({ forMs: 0 }).take());
    expect(canStart(state)).toBe(false);
    state = play(start(), script.take());
    expect(canStart(state)).toBe(true);
    state = apply(state, { type: 'start' });
    expect(state.tracker.baseline).toBe(312);
    expect(canStart(state)).toBe(false);
  });

  it('M6-4: Next records the scale amount on the flow step, without float noise', () => {
    const script = scaleScript().baseline(312.3);
    let state = apply(play(start(), script.take()), { type: 'start' });
    state = apply(play(state, script.add(214.1).stable().take()), { type: 'next' });
    expectInStep(state);
    expect(state.flow.steps[0]).toMatchObject({ grams: '214.1', fromScale: true });
  });

  it('M3-4: a Next that waits records when the scale settles, on a reading', () => {
    const script = scaleScript().baseline(312);
    let state = apply(play(start(), script.take()), { type: 'start' });
    state = apply(play(state, script.add(200).take()), { type: 'next' });
    expect(state.tracker.pending?.type).toBe('waiting');
    expect(state.flow.current).toBe(0);
    state = play(state, script.add(14).stable().take());
    expectInStep(state);
    expect(grams(state)[0]).toBe('214');
  });

  it('M3-4: a proposal is recorded on confirm', () => {
    const script = scaleScript().baseline(312);
    let state = apply(play(start(), script.take()), { type: 'start' });
    state = apply(play(state, script.add(214).take()), { type: 'next' });
    state = play(state, script.unstable({ forMs: 2000 }).take());
    expect(state.tracker.pending?.type).toBe('confirming');
    state = apply(state, { type: 'confirm' });
    expectInStep(state);
    expect(state.flow.steps[0]).toMatchObject({ grams: '214', fromScale: true });
  });

  it('M3-6, M6-5: a negative step is corrected by hand and saved as manual', () => {
    const script = scaleScript().baseline(312);
    let state = apply(play(start(), script.take()), { type: 'start' });
    state = apply(play(state, script.add(214).stable().take()), { type: 'next' });
    state = apply(play(state, script.tare().add(18).stable().take()), { type: 'next' });
    expect(state.tracker.pending?.type).toBe('needsCorrection');
    state = apply(state, { type: 'correct', grams: '20,5' });
    expectInStep(state);
    state = apply(play(state, script.add(30).stable().take()), { type: 'next' });
    expectInStep(state);
    expect(isSummary(state.flow)).toBe(true);
    const items = saveRequest(state.flow, '2026-01-15T07:05:00.000Z')!.meal.items;
    expect(items.map((i) => (i.skipped ? '-' : [i.grams, i.weightSource]))).toEqual([
      [214, 'scale'],
      [20.5, 'manual'],
      [30, 'scale'],
    ]);
  });

  it('M6-5: a correction must be valid grams', () => {
    const script = scaleScript().baseline(312);
    const state = apply(play(start(), script.take()), { type: 'start' });
    for (const typed of ['', 'abc', '-3']) {
      expect(apply(state, { type: 'correct', grams: typed })).toEqual(state);
    }
  });

  it('skip and undo keep the flow and the tracker on the same step', () => {
    const script = scaleScript().baseline(312);
    let state = apply(play(start(), script.take()), { type: 'start' });
    state = apply(play(state, script.add(214).stable().take()), { type: 'next' });
    state = apply(state, { type: 'skip' });
    expectInStep(state);
    state = apply(state, { type: 'undo' });
    expectInStep(state);
    expect(state.flow.current).toBe(1);
    state = apply(state, { type: 'skip' }, { type: 'skip' });
    expect(isSummary(state.flow)).toBe(true);
    // Undo from the summary, then undo every step back to before Start.
    state = apply(state, { type: 'undo' }, { type: 'undo' }, { type: 'undo' });
    expectInStep(state);
    expect(state.flow.current).toBe(0);
    state = apply(state, { type: 'undo' });
    expect(state.tracker.baseline).toBeUndefined();
    expectInStep(state);
  });

  it('Next, confirm and correct need a product, so the flow can take the step', () => {
    const script = scaleScript().baseline(312);
    let state = apply(play(start([undefined, milk, cucumber]), script.take()), { type: 'start' });
    state = play(state, script.add(214).stable().take());
    expect(canNext(state)).toBe(false);
    expect(apply(state, { type: 'next' }, { type: 'correct', grams: '5' })).toEqual(state);
    state = apply(state, { type: 'selectProduct', productId: curd }, { type: 'next' });
    expectInStep(state);
    expect(grams(state)[0]).toBe('214');
  });

  it('M6-10: while the scale shows another unit, Start and Next are off', () => {
    const script = scaleScript().baseline(312);
    let state = play(start(), script.wrongUnit().take());
    expect(state.wrongUnit).toBe(true);
    expect(canStart(state)).toBe(false);
    state = apply(play(state, script.stable().take()), { type: 'start' });
    expect(state.wrongUnit).toBe(false);
    state = play(state, script.add(214).stable().wrongUnit().take());
    expect(canNext(state)).toBe(false);
    expect(apply(state, { type: 'next' })).toEqual(state);
    state = play(state, script.stable().take());
    expect(canNext(state)).toBe(true);
  });

  it('after the scale drops, the remaining steps take typed grams, and the meal still saves as a scale meal', () => {
    const script = scaleScript().baseline(312);
    let state = apply(play(start(), script.take()), { type: 'start' });
    state = apply(play(state, script.add(214).stable().take()), { type: 'next' });
    state = apply(state, { type: 'dropped' });
    expect(state.manual).toBe(true);
    expect(canNext(state)).toBe(false);
    state = apply(
      state,
      { type: 'setGrams', grams: '50' },
      { type: 'next' },
      { type: 'skip' },
      { type: 'undo' },
      { type: 'setGrams', grams: '10' },
      { type: 'next' },
    );
    expect(isSummary(state.flow)).toBe(true);
    const request = saveRequest(state.flow, '2026-01-15T07:05:00.000Z')!;
    expect(saveMealRequestSchema.parse(request)).toEqual(request);
    expect(request.meal.inputMethod).toBe('scale');
    expect(request.meal.items.map((i) => (i.skipped ? '-' : [i.grams, i.weightSource]))).toEqual([
      [214, 'scale'],
      [50, 'manual'],
      [10, 'manual'],
    ]);
  });

  it('M6-5: summary edits change only the flow, and save as manual', () => {
    const script = scaleScript().baseline(312);
    let state = apply(play(start(), script.take()), { type: 'start' });
    for (const added of [214, 18, 30]) {
      state = apply(play(state, script.add(added).stable().take()), { type: 'next' });
    }
    state = apply(state, { type: 'editGrams', index: 1, grams: '20' });
    expectInStep(state);
    expect(state.flow.steps[1]).toEqual({ productId: milk, grams: '20', skipped: false });
  });
});
