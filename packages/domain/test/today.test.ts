import { describe, expect, it } from 'vitest';
import {
  targetProgress,
  todaySchema,
  withPending,
  type NutritionValues,
  type Today,
} from '../src/index.js';

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

describe('pending meals in Today (M5-9)', () => {
  const nutrition = (kcal: number, fibre: number | null = 1) => ({
    kcal,
    fat: 1,
    saturates: 0,
    carbs: 1,
    sugars: 0,
    protein: 10,
    salt: 0,
    fibre,
  });
  const today: Today = {
    timezone: 'Europe/Warsaw',
    day: '2026-01-15',
    targets: { protein: null, fat: null, carbs: null, fibre: null, kcal: null },
    totals: nutrition(300),
    entries: [
      {
        id: 'a1a1a1a1-0000-4000-8000-000000000001',
        preparedMealId: 'b1b1b1b1-0000-4000-8000-000000000001',
        eatenAt: '2026-01-15T07:00:00.000Z',
        recipeName: { en: 'Curd' },
        nutrition: nutrition(300),
      },
    ],
  };
  const pending = (id: string, eatenAt: string, kcal: number, fibre: number | null = 1) => ({
    id,
    preparedMealId: id.replace('a2', 'b2'),
    eatenAt,
    recipeName: { en: 'Sandwich' },
    nutrition: nutrition(kcal, fibre),
  });

  it('M5-9: pending meals of the day are listed, newest first, and counted in the totals', () => {
    const later = pending('a2a2a2a2-0000-4000-8000-000000000002', '2026-01-15T09:00:00.000Z', 200);
    const result = withPending(today, [later]);
    expect(result.entries.map((e) => [e.id, e.pending])).toEqual([
      [later.id, true],
      [today.entries[0]!.id, false],
    ]);
    expect(result.totals.kcal).toBe(500);
    expect(result.totals.fibre).toBe(2);
  });

  it('M5-9, M2-5: a pending meal of another day in the user timezone is left out', () => {
    // 23:30 on the 14th in Warsaw.
    const yesterday = pending(
      'a2a2a2a2-0000-4000-8000-000000000003',
      '2026-01-14T22:30:00.000Z',
      200,
    );
    expect(withPending(today, [yesterday])).toEqual({
      entries: [{ ...today.entries[0]!, pending: false }],
      totals: today.totals,
    });
  });

  it('M5-9: a pending meal the server already has is counted once', () => {
    const synced = { ...pending(today.entries[0]!.id, today.entries[0]!.eatenAt, 300) };
    const result = withPending(today, [synced]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.pending).toBe(false);
    expect(result.totals.kcal).toBe(300);
  });

  it('M5-9, M2-3: an unknown value in a pending meal makes that total unknown', () => {
    const noFibre = pending(
      'a2a2a2a2-0000-4000-8000-000000000004',
      '2026-01-15T09:00:00.000Z',
      100,
      null,
    );
    expect(withPending(today, [noFibre]).totals).toMatchObject({ fibre: null, kcal: 400 });
  });
});
