import { saveMealRequestSchema, type Recipe } from '@macrofill/domain';
import { describe, expect, it } from 'vitest';
import {
  directEntry,
  isSummary,
  saveRequest,
  startDirectEntry,
  stepProblem,
  type DirectEntryState,
} from '../src/directEntry/state';

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

const start = () =>
  startDirectEntry({
    recipe,
    preselected: [curd, undefined, cucumber],
    mealId: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
    entryId: 'c8f4d2b3-5e6a-4f7b-8c9d-8e7f6a5b4c3d',
    startedAt: '2026-01-15T07:00:00.000Z',
  });

const apply = (state: DirectEntryState, ...actions: Parameters<typeof directEntry>[1][]) =>
  actions.reduce(directEntry, state);

describe('Direct Entry flow state', () => {
  it('starts at the first step with the preselected products and no grams', () => {
    const state = start();
    expect(state.current).toBe(0);
    expect(state.steps.map((s) => s.productId)).toEqual([curd, undefined, cucumber]);
    expect(state.steps.every((s) => s.grams === '' && !s.skipped)).toBe(true);
  });

  it('is plain JSON, so it can be persisted later (M5-8)', () => {
    const state = apply(start(), { type: 'setGrams', grams: '3,2' });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('M5-3: Next accepts 3,2 and 3.2, and refuses empty, non-numeric and negative grams', () => {
    for (const grams of ['', 'abc', '-1']) {
      const state = apply(start(), { type: 'setGrams', grams }, { type: 'next' });
      expect(state.current).toBe(0);
    }
    expect(stepProblem(apply(start(), { type: 'setGrams', grams: '' }).steps[0]!)).toBe('empty');
    expect(stepProblem(apply(start(), { type: 'setGrams', grams: '-1' }).steps[0]!)).toBe(
      'negative',
    );
    expect(stepProblem(apply(start(), { type: 'setGrams', grams: 'x' }).steps[0]!)).toBe('invalid');
    for (const grams of ['3,2', '3.2']) {
      expect(apply(start(), { type: 'setGrams', grams }, { type: 'next' }).current).toBe(1);
    }
  });

  it('M5-2: Next needs a product', () => {
    const atMilk = apply(start(), { type: 'setGrams', grams: '200' }, { type: 'next' });
    const stuck = apply(atMilk, { type: 'setGrams', grams: '50' }, { type: 'next' });
    expect(stuck.current).toBe(1);
    expect(stepProblem(stuck.steps[1]!)).toBe('product');
    const moved = apply(stuck, { type: 'selectProduct', productId: milk }, { type: 'next' });
    expect(moved.current).toBe(2);
  });

  it('M5-4: the user can skip a step, whatever its inputs', () => {
    const state = apply(start(), { type: 'skip' });
    expect(state.current).toBe(1);
    expect(state.steps[0]!.skipped).toBe(true);
  });

  it('M5-5: Undo returns to the previous step with its product and grams restored', () => {
    const state = apply(
      start(),
      { type: 'setGrams', grams: '212,5' },
      { type: 'next' },
      { type: 'undo' },
    );
    expect(state.current).toBe(0);
    expect(state.steps[0]).toEqual({ productId: curd, grams: '212,5', skipped: false });
  });

  it('M5-5: Undo onto a skipped step un-skips it, keeping what was entered before skipping', () => {
    const state = apply(
      start(),
      { type: 'setGrams', grams: '10' },
      { type: 'skip' },
      { type: 'undo' },
    );
    expect(state.steps[0]).toEqual({ productId: curd, grams: '10', skipped: false });
  });

  it('M5-5: Undo on the first step does nothing', () => {
    expect(apply(start(), { type: 'undo' })).toEqual(start());
  });

  it('M5-5: Undo from the summary returns to the last step', () => {
    const summary = apply(start(), { type: 'skip' }, { type: 'skip' }, { type: 'skip' });
    expect(isSummary(summary)).toBe(true);
    const back = apply(summary, { type: 'undo' });
    expect(back.current).toBe(2);
    expect(back.steps[2]!.skipped).toBe(false);
  });

  it('M5-6: any item grams can be edited in the summary', () => {
    const summary = apply(
      start(),
      { type: 'setGrams', grams: '200' },
      { type: 'next' },
      { type: 'skip' },
      { type: 'setGrams', grams: '30' },
      { type: 'next' },
    );
    expect(isSummary(summary)).toBe(true);
    const edited = apply(summary, { type: 'editGrams', index: 0, grams: '180,5' });
    expect(edited.steps[0]!.grams).toBe('180,5');
    // Skipped items have no grams to edit.
    expect(apply(summary, { type: 'editGrams', index: 1, grams: '5' })).toEqual(summary);
  });

  it('builds the save request with the ids generated at the start, so retries are idempotent', () => {
    const summary = apply(
      start(),
      { type: 'setGrams', grams: '212,5' },
      { type: 'next' },
      { type: 'skip' },
      { type: 'setGrams', grams: ' 30.25 ' },
      { type: 'next' },
    );
    const request = saveRequest(summary, '2026-01-15T07:05:00.000Z');
    expect(saveMealRequestSchema.parse(request)).toEqual(request);
    expect(request).toEqual({
      meal: {
        id: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
        recipeId: recipe.id,
        inputMethod: 'direct',
        startedAt: '2026-01-15T07:00:00.000Z',
        finishedAt: '2026-01-15T07:05:00.000Z',
        items: [
          {
            stepId: recipe.steps[0]!.id,
            skipped: false,
            productId: curd,
            grams: 212.5,
            weightSource: 'manual',
          },
          { stepId: recipe.steps[1]!.id, skipped: true },
          {
            stepId: recipe.steps[2]!.id,
            skipped: false,
            productId: cucumber,
            grams: 30.25,
            weightSource: 'manual',
          },
        ],
      },
      consumptionEntry: {
        id: 'c8f4d2b3-5e6a-4f7b-8c9d-8e7f6a5b4c3d',
        eatenAt: '2026-01-15T07:05:00.000Z',
        portion: { type: 'whole' },
      },
    });
  });

  it('has no save request while a summary item has invalid grams', () => {
    const summary = apply(
      start(),
      { type: 'setGrams', grams: '200' },
      { type: 'next' },
      { type: 'skip' },
      { type: 'skip' },
    );
    const broken = apply(summary, { type: 'editGrams', index: 0, grams: '-3' });
    expect(saveRequest(broken, '2026-01-15T07:05:00.000Z')).toBeUndefined();
  });
});

describe('the flow in Scale Mode', () => {
  const startScale = () =>
    startDirectEntry({
      recipe,
      preselected: [curd, undefined, cucumber],
      mealId: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
      entryId: 'c8f4d2b3-5e6a-4f7b-8c9d-8e7f6a5b4c3d',
      startedAt: '2026-01-15T07:00:00.000Z',
      inputMethod: 'scale',
    });

  it('M6-4: a recorded scale amount completes the step', () => {
    const state = apply(startScale(), { type: 'record', grams: 214.1 });
    expect(state.current).toBe(1);
    expect(state.steps[0]).toEqual({
      productId: curd,
      grams: '214.1',
      skipped: false,
      fromScale: true,
    });
  });

  it('M6-4: recording needs a product and non-negative grams, like Next', () => {
    const atMilk = apply(startScale(), { type: 'record', grams: 214 });
    expect(apply(atMilk, { type: 'record', grams: 50 })).toEqual(atMilk);
    expect(apply(startScale(), { type: 'record', grams: -1 })).toEqual(startScale());
  });

  it('M6-5: typed grams replace a scale amount, during the flow and in the summary', () => {
    const recorded = apply(startScale(), { type: 'record', grams: 214 }, { type: 'undo' });
    expect(apply(recorded, { type: 'setGrams', grams: '200' }).steps[0]).toEqual({
      productId: curd,
      grams: '200',
      skipped: false,
    });
    const summary = apply(
      startScale(),
      { type: 'record', grams: 214 },
      { type: 'skip' },
      { type: 'record', grams: 30 },
    );
    expect(isSummary(summary)).toBe(true);
    expect(apply(summary, { type: 'editGrams', index: 2, grams: '25' }).steps[2]).toEqual({
      productId: cucumber,
      grams: '25',
      skipped: false,
    });
  });

  it('M6-5: a Scale Mode meal saves with its input method and each weight source', () => {
    const summary = apply(
      startScale(),
      { type: 'record', grams: 214 },
      { type: 'skip' },
      { type: 'record', grams: 30 },
      { type: 'editGrams', index: 0, grams: '200' },
    );
    const request = saveRequest(summary, '2026-01-15T07:05:00.000Z')!;
    expect(saveMealRequestSchema.parse(request)).toEqual(request);
    expect(request.meal.inputMethod).toBe('scale');
    expect(request.meal.items).toEqual([
      {
        stepId: recipe.steps[0]!.id,
        skipped: false,
        productId: curd,
        grams: 200,
        weightSource: 'manual',
      },
      { stepId: recipe.steps[1]!.id, skipped: true },
      {
        stepId: recipe.steps[2]!.id,
        skipped: false,
        productId: cucumber,
        grams: 30,
        weightSource: 'scale',
      },
    ]);
  });
});

describe('a product of another class picked on purpose (#64-5)', () => {
  it('is marked on the step, and the mark follows typed grams and an undo', () => {
    const picked = directEntry(start(), {
      type: 'selectProduct',
      productId: milk,
      otherClass: true,
    });
    expect(picked.steps[0]).toMatchObject({ productId: milk, otherClass: true });
    const typed = directEntry(picked, { type: 'setGrams', grams: '150' });
    expect(typed.steps[0]).toMatchObject({ productId: milk, grams: '150', otherClass: true });
    const back = apply(typed, { type: 'next' }, { type: 'undo' });
    expect(back.steps[0]).toMatchObject({ productId: milk, otherClass: true });
  });

  it('is gone once a product of the step’s own class is picked', () => {
    const picked = directEntry(start(), {
      type: 'selectProduct',
      productId: milk,
      otherClass: true,
    });
    const own = directEntry(picked, { type: 'selectProduct', productId: curd });
    expect(own.steps[0]).toEqual({ productId: curd, grams: '', skipped: false });
    expect(own.steps[0]).not.toHaveProperty('otherClass');
  });
});
