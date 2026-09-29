import { describe, expect, it } from 'vitest';
import {
  consumptionEntrySchema,
  dailyTargetsSchema,
  ingredientClassSchema,
  preparedMealSchema,
  recipeSchema,
  saveMealRequestSchema,
} from '../src/index.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('entity schemas', () => {
  it('an ingredient class has a slug id and a localized name', () => {
    expect(ingredientClassSchema.safeParse({ id: 'curd', name: { en: 'Curd' } }).success).toBe(
      true,
    );
    expect(
      ingredientClassSchema.safeParse({ id: 'curd', name: { en: 'Curd', pl: 'Twaróg' } }).success,
    ).toBe(true);
    expect(
      ingredientClassSchema.safeParse({ id: 'Curd Cheese', name: { en: 'Curd' } }).success,
    ).toBe(false);
    expect(ingredientClassSchema.safeParse({ id: 'curd', name: { pl: 'Twaróg' } }).success).toBe(
      false,
    );
  });

  it('a recipe is an ordered list of steps with an optional default product', () => {
    const recipe = recipeSchema.parse({
      id: uuid(1),
      name: { en: 'Curd' },
      steps: [
        { id: uuid(2), ingredientClassId: 'curd', defaultProductId: uuid(3) },
        { id: uuid(4), ingredientClassId: 'milk' },
      ],
    });
    expect(recipe.steps.map((s) => s.ingredientClassId)).toEqual(['curd', 'milk']);
  });

  it('a prepared meal records its input method, times and items', () => {
    const meal = {
      id: uuid(10),
      recipeId: uuid(1),
      inputMethod: 'direct',
      startedAt: '2026-01-15T07:00:00.000Z',
      finishedAt: '2026-01-15T07:05:00.000Z',
      items: [
        { stepId: uuid(2), skipped: false, productId: uuid(3), grams: 150, weightSource: 'manual' },
        { stepId: uuid(4), skipped: true },
      ],
    };
    expect(preparedMealSchema.safeParse(meal).success).toBe(true);
    expect(preparedMealSchema.safeParse({ ...meal, inputMethod: 'guess' }).success).toBe(false);
    expect(preparedMealSchema.safeParse({ ...meal, id: 'not-a-uuid' }).success).toBe(false);
    const withoutRecipe = Object.fromEntries(
      Object.entries(meal).filter(([k]) => k !== 'recipeId'),
    );
    expect(preparedMealSchema.safeParse(withoutRecipe).success).toBe(true);
  });

  it('request shapes carry no ownerId; the server sets it from auth', () => {
    const meal = preparedMealSchema.parse({
      id: uuid(10),
      inputMethod: 'direct',
      startedAt: '2026-01-15T07:00:00.000Z',
      finishedAt: '2026-01-15T07:05:00.000Z',
      items: [],
      ownerId: uuid(99),
    });
    expect(meal).not.toHaveProperty('ownerId');
  });

  it('a consumption entry is the whole meal in MVP0', () => {
    const entry = {
      id: uuid(20),
      preparedMealId: uuid(10),
      eatenAt: '2026-01-15T07:05:00.000Z',
      portion: { type: 'whole' },
    };
    expect(consumptionEntrySchema.safeParse(entry).success).toBe(true);
    expect(
      consumptionEntrySchema.safeParse({ ...entry, portion: { type: 'grams', grams: 100 } })
        .success,
    ).toBe(false);
  });

  it('daily targets are each optional; unset is null, never 0', () => {
    const targets = dailyTargetsSchema.parse({
      protein: 150,
      fat: null,
      carbs: null,
      fibre: 30,
      kcal: 2200,
    });
    // Unsetting one target leaves the others tracked.
    expect(targets).toEqual({ protein: 150, fat: null, carbs: null, fibre: 30, kcal: 2200 });
    expect(dailyTargetsSchema.safeParse({ ...targets, protein: -1 }).success).toBe(false);
    expect(dailyTargetsSchema.safeParse({ protein: 150 }).success).toBe(false);
  });
});

describe('M4-6: save meal request', () => {
  const request = {
    meal: {
      id: uuid(10),
      inputMethod: 'direct',
      startedAt: '2026-01-15T07:00:00.000Z',
      finishedAt: '2026-01-15T07:05:00.000Z',
      items: [],
    },
    consumptionEntry: {
      id: uuid(20),
      eatenAt: '2026-01-15T07:05:00.000Z',
      portion: { type: 'whole' },
    },
  };

  it('carries the meal and its consumption entry, both with client-generated ids', () => {
    expect(saveMealRequestSchema.safeParse(request).success).toBe(true);
    expect(
      saveMealRequestSchema.safeParse({
        ...request,
        consumptionEntry: { ...request.consumptionEntry, id: 'x' },
      }).success,
    ).toBe(false);
  });

  it('the entry points at the meal implicitly; a client-sent preparedMealId is dropped', () => {
    const parsed = saveMealRequestSchema.parse({
      ...request,
      consumptionEntry: { ...request.consumptionEntry, preparedMealId: uuid(99) },
    });
    expect(parsed.consumptionEntry).not.toHaveProperty('preparedMealId');
  });
});
