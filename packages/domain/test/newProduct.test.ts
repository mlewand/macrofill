import { describe, expect, it } from 'vitest';
import {
  createProductRequestSchema,
  kcalMismatch,
  parseLabelValue,
  type NutritionValues,
} from '../src/index.js';

const unknown: NutritionValues = {
  kcal: null,
  fat: null,
  saturates: null,
  carbs: null,
  sugars: null,
  protein: null,
  salt: null,
  fibre: null,
};

describe('#64-2: label values', () => {
  it.each([
    ['3,2', 3.2],
    ['3.2', 3.2],
    [' 0 ', 0],
    ['100', 100],
  ])('accepts %j as %d', (input, value) => {
    expect(parseLabelValue('fat', input)).toEqual({ ok: true, value });
  });

  it('#64-1: an empty value is unknown, not 0', () => {
    expect(parseLabelValue('fibre', '')).toEqual({ ok: true, value: null });
    expect(parseLabelValue('fibre', '  ')).toEqual({ ok: true, value: null });
  });

  it('#64-2: rejects a negative or malformed value', () => {
    expect(parseLabelValue('fat', '-1')).toEqual({ ok: false, reason: 'negative' });
    expect(parseLabelValue('fat', 'abc')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseLabelValue('fat', '1e3')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('#64-2: rejects more than 100 g per 100 g, for the gram nutrients only', () => {
    for (const nutrient of [
      'fat',
      'saturates',
      'carbs',
      'sugars',
      'protein',
      'salt',
      'fibre',
    ] as const) {
      expect(parseLabelValue(nutrient, '100,5')).toEqual({ ok: false, reason: 'tooLarge' });
    }
    // Energy isn't a weight: 884 kcal per 100 g is ordinary for oil.
    expect(parseLabelValue('kcal', '884')).toEqual({ ok: true, value: 884 });
  });
});

describe('#64-3: kcal consistency', () => {
  const milk: NutritionValues = {
    ...unknown,
    protein: 3.3,
    carbs: 4.8,
    fat: 3.2,
    fibre: 0,
    kcal: 4 * 3.3 + 4 * 4.8 + 9 * 3.2 + 0,
  };

  it('accepts kcal that matches the macros', () => {
    expect(kcalMismatch(milk)).toBeUndefined();
  });

  it('is skipped when kcal, protein, carbs, fat or fibre is unknown', () => {
    for (const nutrient of ['kcal', 'protein', 'carbs', 'fat', 'fibre'] as const) {
      expect(kcalMismatch({ ...milk, [nutrient]: null }), nutrient).toBeUndefined();
    }
    // Saturates, sugars and salt don't enter the estimate.
    expect(kcalMismatch({ ...milk, kcal: 900, saturates: null, sugars: null, salt: null })).toEqual(
      {
        expected: 4 * 3.3 + 4 * 4.8 + 9 * 3.2,
      },
    );
  });

  it('reports a mismatch beyond max(15% of the estimate, 10 kcal), with the estimate', () => {
    // Estimate 200: 15% is 30.
    const base = { ...unknown, protein: 10, carbs: 20, fat: 8.888888888888889, fibre: 0 };
    const e = 4 * 10 + 4 * 20 + 9 * base.fat;
    expect(kcalMismatch({ ...base, kcal: e + 29.9 })).toBeUndefined();
    expect(kcalMismatch({ ...base, kcal: e - 29.9 })).toBeUndefined();
    expect(kcalMismatch({ ...base, kcal: e + 30.5 })).toEqual({ expected: e });
    expect(kcalMismatch({ ...base, kcal: e - 30.5 })).toEqual({ expected: e });
  });

  it('allows at least 10 kcal for a low-energy product', () => {
    // Estimate 20 (a cucumber): 15% is 3, so 10 kcal applies.
    const cucumber = { ...unknown, protein: 1, carbs: 4, fat: 0, fibre: 0 };
    expect(kcalMismatch({ ...cucumber, kcal: 29.9 })).toBeUndefined();
    expect(kcalMismatch({ ...cucumber, kcal: 30.1 })).toEqual({ expected: 20 });
    // Estimate 0: anything above 10 is off.
    const water = { ...unknown, protein: 0, carbs: 0, fat: 0, fibre: 0 };
    expect(kcalMismatch({ ...water, kcal: 10 })).toBeUndefined();
    expect(kcalMismatch({ ...water, kcal: 10.1 })).toEqual({ expected: 0 });
  });

  it('counts fibre at 2 kcal per gram', () => {
    const oats = { ...unknown, protein: 0, carbs: 0, fat: 0, fibre: 50 };
    expect(kcalMismatch({ ...oats, kcal: 100 })).toBeUndefined();
    expect(kcalMismatch({ ...oats, kcal: 140 })).toEqual({ expected: 100 });
  });
});

describe('#64-1, #64-2: the create product request', () => {
  const request = {
    id: '4f0c7a3e-3b8e-4d7a-9a51-6c1f2d9e8b01',
    ingredientClassId: 'curd',
    name: ' Homemade curd ',
    nutrition: { ...unknown, kcal: 119, protein: 17, carbs: 3.4, fat: 4.2 },
  };

  it('accepts a product with unknown values, and trims the name', () => {
    const parsed = createProductRequestSchema.parse(request);
    expect(parsed.name).toBe('Homemade curd');
    expect(parsed.nutrition.fibre).toBeNull();
    expect(parsed.brand).toBeUndefined();
  });

  it('needs a name, and a brand if present is not blank', () => {
    expect(createProductRequestSchema.safeParse({ ...request, name: '  ' }).success).toBe(false);
    expect(createProductRequestSchema.safeParse({ ...request, brand: '' }).success).toBe(false);
    expect(createProductRequestSchema.safeParse({ ...request, brand: 'Polmlek' }).success).toBe(
      true,
    );
  });

  it('needs a client id and a class slug', () => {
    expect(createProductRequestSchema.safeParse({ ...request, id: 'x' }).success).toBe(false);
    expect(
      createProductRequestSchema.safeParse({ ...request, ingredientClassId: 'Not A Slug' }).success,
    ).toBe(false);
  });

  it('rejects a negative value and a gram value above 100', () => {
    const with_ = (nutrition: Partial<NutritionValues>) =>
      createProductRequestSchema.safeParse({
        ...request,
        nutrition: { ...request.nutrition, ...nutrition },
      }).success;
    expect(with_({ fat: -1 })).toBe(false);
    expect(with_({ sugars: 100.5 })).toBe(false);
    expect(with_({ kcal: 884 })).toBe(true);
  });

  it('rejects carbs + protein + fat above 100 g, and the M2-6 sum with fibre and salt', () => {
    const with_ = (nutrition: Partial<NutritionValues>) =>
      createProductRequestSchema.safeParse({
        ...request,
        nutrition: { ...unknown, ...nutrition },
      }).success;
    expect(with_({ carbs: 50, protein: 30, fat: 20 })).toBe(true);
    expect(with_({ carbs: 50, protein: 30, fat: 20.1 })).toBe(false);
    expect(with_({ carbs: 50, protein: 30, fat: 19, fibre: 1, salt: 0.5 })).toBe(false);
  });
});
