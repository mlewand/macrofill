import { describe, expect, it } from 'vitest';
import { targetProgress, todaySchema, type NutritionValues } from '../src/index.js';

const consumed: NutritionValues = {
  kcal: 2850.4,
  fat: 40,
  saturates: 10,
  carbs: 200,
  sugars: 50,
  protein: 120.25,
  salt: 5,
  fibre: null,
};

describe('M7-2: consumed, target and remaining per nutrient', () => {
  const progress = targetProgress(consumed, {
    protein: 160,
    fat: 65,
    carbs: null,
    fibre: 30,
    kcal: 2700,
  });
  const of = (nutrient: string) => progress.find((p) => p.nutrient === nutrient);

  it('covers protein, fat, carbs, fibre and kcal, in that order', () => {
    expect(progress.map((p) => p.nutrient)).toEqual(['protein', 'fat', 'carbs', 'fibre', 'kcal']);
  });

  it('remaining is target minus consumed, unrounded (M2-4)', () => {
    expect(of('protein')).toEqual({
      nutrient: 'protein',
      consumed: 120.25,
      target: 160,
      remaining: 39.75,
    });
  });

  it('goes negative when over the target', () => {
    expect(of('kcal')?.remaining).toBeCloseTo(-150.4, 10);
  });

  it('a nutrient without a target shows only consumed', () => {
    expect(of('carbs')).toEqual({
      nutrient: 'carbs',
      consumed: 200,
      target: null,
      remaining: null,
    });
  });

  it('M7-3: unknown fibre stays unknown, and so does its remaining', () => {
    expect(of('fibre')).toEqual({ nutrient: 'fibre', consumed: null, target: 30, remaining: null });
  });
});

describe('Today response', () => {
  it('parses a day with entries', () => {
    const today = {
      timezone: 'Europe/Warsaw',
      day: '2026-01-15',
      targets: { protein: 160, fat: 65, carbs: null, fibre: null, kcal: 2700 },
      totals: consumed,
      entries: [
        {
          id: 'c8f4d2b3-5e6a-4f7b-8c9d-8e7f6a5b4c3d',
          preparedMealId: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
          eatenAt: '2026-01-15T07:05:00.000Z',
          recipeName: { en: 'Curd' },
          nutrition: consumed,
        },
      ],
    };
    expect(todaySchema.parse(today)).toEqual(today);
    expect(todaySchema.safeParse({ ...today, day: '15.01.2026' }).success).toBe(false);
  });
});
