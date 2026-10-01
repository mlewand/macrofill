import { describe, expect, it } from 'vitest';
import { directEntry, startDirectEntry, type DirectEntryState } from '../src/directEntry/state';
import { flowEvents } from '../src/events/flowEvents';

const recipe = {
  id: '9a13c2a4-8d6e-401e-aeb3-deb367561938',
  name: { en: 'Curd' },
  steps: [
    { id: 'a6b75d73-d68a-4eec-8219-5a16aeb9917e', ingredientClassId: 'curd' },
    { id: 'b48924bb-4fa3-4843-b727-6928f03636d0', ingredientClassId: 'milk' },
  ],
};
const product = '033ee3fe-72a7-409c-8dc3-76626baa14db';

const start = (inputMethod: 'direct' | 'scale' = 'direct') =>
  startDirectEntry({
    recipe,
    preselected: [product, product],
    mealId: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
    entryId: 'c8f4d2b3-5e6a-4f7b-8c9d-8e7f6a5b4c3d',
    startedAt: '2026-01-15T07:00:00.000Z',
    inputMethod,
  });

const typed = (state: DirectEntryState, grams: string) =>
  directEntry(directEntry(state, { type: 'setGrams', grams }), { type: 'next' });

describe('flow events (M7-8)', () => {
  it('M7-8: a completed step, with its duration and weight source', () => {
    const before = start();
    expect(flowEvents(before, typed(before, '200'), 8000)).toEqual([
      {
        name: 'step_completed',
        props: { inputMethod: 'direct', step: 0, durationMs: 8000, weightSource: 'manual' },
      },
    ]);
    const scale = start('scale');
    const recorded = directEntry(scale, { type: 'record', grams: 214 });
    expect(flowEvents(scale, recorded, 3000)).toEqual([
      {
        name: 'step_completed',
        props: { inputMethod: 'scale', step: 0, durationMs: 3000, weightSource: 'scale' },
      },
    ]);
  });

  it('M7-8: skip and undo', () => {
    const before = start();
    const skipped = directEntry(before, { type: 'skip' });
    expect(flowEvents(before, skipped, 100)).toEqual([
      { name: 'step_skipped', props: { inputMethod: 'direct', step: 0 } },
    ]);
    expect(flowEvents(skipped, directEntry(skipped, { type: 'undo' }), 100)).toEqual([
      { name: 'step_undone', props: { inputMethod: 'direct', step: 0 } },
    ]);
  });

  it('M7-8: in Scale Mode, typed grams are a manual correction, in the flow and in the summary', () => {
    const scale = start('scale');
    expect(flowEvents(scale, typed(scale, '20'), 500)).toEqual([
      {
        name: 'step_completed',
        props: { inputMethod: 'scale', step: 0, durationMs: 500, weightSource: 'manual' },
      },
      { name: 'manual_correction', props: { inputMethod: 'scale', step: 0 } },
    ]);
    let summary = directEntry(scale, { type: 'record', grams: 214 });
    summary = directEntry(summary, { type: 'record', grams: 18 });
    const edited = directEntry(summary, { type: 'editGrams', index: 1, grams: '20' });
    expect(flowEvents(summary, edited, 0)).toEqual([
      { name: 'manual_correction', props: { inputMethod: 'scale', step: 1 } },
    ]);
    // Editing it again isn't another correction from the scale's amount.
    expect(
      flowEvents(edited, directEntry(edited, { type: 'editGrams', index: 1, grams: '21' }), 0),
    ).toEqual([]);
  });

  it('M7-8: typing grams or picking a product is no event', () => {
    const before = start();
    expect(flowEvents(before, directEntry(before, { type: 'setGrams', grams: '5' }), 0)).toEqual(
      [],
    );
    expect(
      flowEvents(before, directEntry(before, { type: 'selectProduct', productId: product }), 0),
    ).toEqual([]);
  });

  it('M7-8: steps recorded at once each count, the time shown going to the first', () => {
    const scale = start('scale');
    const both = directEntry(directEntry(scale, { type: 'record', grams: 214 }), {
      type: 'skip',
    });
    expect(flowEvents(scale, both, 4000)).toEqual([
      {
        name: 'step_completed',
        props: { inputMethod: 'scale', step: 0, durationMs: 4000, weightSource: 'scale' },
      },
      { name: 'step_skipped', props: { inputMethod: 'scale', step: 1 } },
    ]);
  });
});
