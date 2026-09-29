import { describe, expect, it } from 'vitest';
import {
  NUTRIENTS,
  dayNutrition,
  itemNutrition,
  mealNutrition,
  preparedMealItemSchema,
  type NutritionValues,
  type PreparedMealItem,
} from '../src/index.js';

const bread: NutritionValues = {
  kcal: 247,
  fat: 3.4,
  saturates: 0.7,
  carbs: 41,
  sugars: 4.1,
  protein: 13,
  salt: 1.1,
  fibre: 7,
};
const ham: NutritionValues = {
  kcal: 107,
  fat: 3,
  saturates: 1.1,
  carbs: 1.5,
  sugars: 1,
  protein: 19,
  salt: 2.3,
  fibre: null,
};
const cucumber: NutritionValues = {
  kcal: 11,
  fat: 0.5,
  saturates: 0.1,
  carbs: 1,
  sugars: 0.5,
  protein: 0.7,
  salt: 1.9,
  fibre: 0,
};

const products = new Map<string, NutritionValues>([
  ['bread', bread],
  ['ham', ham],
  ['cucumber', cucumber],
]);

function item(productId: string, grams: number): PreparedMealItem {
  return { skipped: false, productId, grams, weightSource: 'manual' };
}

describe('M2-1: item nutrition', () => {
  it.each(NUTRIENTS.map((n) => [n]))('%s = grams × per-100 g value / 100', (nutrient) => {
    expect(itemNutrition(bread, 37.5)[nutrient]).toBeCloseTo(
      (37.5 * (bread[nutrient] ?? 0)) / 100,
      12,
    );
  });

  it('keeps unknown fibre unknown', () => {
    expect(itemNutrition(ham, 40).fibre).toBeNull();
  });

  it('0 g gives zeros, not unknowns, for known values', () => {
    expect(itemNutrition(bread, 0)).toEqual({
      kcal: 0,
      fat: 0,
      saturates: 0,
      carbs: 0,
      sugars: 0,
      protein: 0,
      salt: 0,
      fibre: 0,
    });
  });
});

describe('M2-2: meal total', () => {
  it('sums the non-skipped items', () => {
    const total = mealNutrition([item('bread', 60), item('cucumber', 30)], products);
    for (const n of NUTRIENTS) {
      expect(total[n]).toBeCloseTo((60 * (bread[n] ?? 0) + 30 * (cucumber[n] ?? 0)) / 100, 12);
    }
  });

  it('ignores skipped items', () => {
    const withSkip = mealNutrition(
      [item('bread', 60), { skipped: true, stepId: '0e1d6d0a-8c4b-4b43-9a53-2f7e5a1c3b10' }],
      products,
    );
    expect(withSkip).toEqual(mealNutrition([item('bread', 60)], products));
  });

  it('an empty meal is all zeros with known fibre', () => {
    expect(mealNutrition([], products)).toEqual({
      kcal: 0,
      fat: 0,
      saturates: 0,
      carbs: 0,
      sugars: 0,
      protein: 0,
      salt: 0,
      fibre: 0,
    });
  });

  it('fails loudly for a product it has no values for', () => {
    expect(() => mealNutrition([item('unknown-product', 10)], products)).toThrow(/unknown-product/);
  });

  it('rejects negative item grams', () => {
    const result = preparedMealItemSchema.safeParse({
      skipped: false,
      productId: '4f0c7a3e-3b8e-4d7a-9a51-6c1f2d9e8b01',
      grams: -1,
      weightSource: 'scale',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toContain('grams');
  });

  it('accepts 0 g items', () => {
    expect(
      preparedMealItemSchema.safeParse({
        skipped: false,
        productId: '4f0c7a3e-3b8e-4d7a-9a51-6c1f2d9e8b01',
        grams: 0,
        weightSource: 'scale',
      }).success,
    ).toBe(true);
  });

  it('a skipped item has no product or grams', () => {
    expect(
      preparedMealItemSchema.safeParse({
        skipped: true,
        productId: '4f0c7a3e-3b8e-4d7a-9a51-6c1f2d9e8b01',
        grams: 10,
      }).success,
    ).toBe(false);
  });
});

describe('M2-3: fibre total', () => {
  it('is unknown if any contributing product has unknown fibre', () => {
    expect(mealNutrition([item('bread', 60), item('ham', 20)], products).fibre).toBeNull();
  });

  it('unknown fibre leaves every other total numeric', () => {
    const total = mealNutrition([item('bread', 60), item('ham', 20)], products);
    for (const n of NUTRIENTS.filter((n) => n !== 'fibre')) {
      expect(total[n]).toBeCloseTo((60 * (bread[n] ?? 0) + 20 * (ham[n] ?? 0)) / 100, 12);
    }
  });

  it('is numeric when every contributing product has fibre, including 0', () => {
    expect(mealNutrition([item('bread', 60), item('cucumber', 30)], products).fibre).toBeCloseTo(
      4.2,
      12,
    );
  });

  it('a skipped step does not contribute its product', () => {
    expect(mealNutrition([item('bread', 60), { skipped: true }], products).fibre).toBeCloseTo(
      4.2,
      12,
    );
  });

  it('a 0 g item with unknown fibre still makes the total unknown', () => {
    expect(mealNutrition([item('bread', 60), item('ham', 0)], products).fibre).toBeNull();
  });

  it('a day total is unknown if any meal total is unknown', () => {
    const known = mealNutrition([item('bread', 60)], products);
    const unknown = mealNutrition([item('ham', 20)], products);
    expect(dayNutrition([known, unknown]).fibre).toBeNull();
    expect(dayNutrition([known, known]).fibre).toBeCloseTo(8.4, 12);
  });
});

describe('M2-4: calculations use unrounded values', () => {
  it('a meal total is the sum of unrounded item values', () => {
    // Each item is 0.33 kcal, which would round to 0 on its own.
    const tiny: NutritionValues = { ...cucumber, kcal: 11 };
    const items = [1, 2, 3].map(() => item('tiny', 3));
    const total = mealNutrition(items, new Map([['tiny', tiny]]));
    expect(total.kcal).toBeCloseTo(0.99, 12);
  });

  it('a day total is the sum of unrounded meal totals', () => {
    const meal = mealNutrition([item('bread', 12.34)], products);
    expect(dayNutrition([meal, meal, meal]).protein).toBeCloseTo(3 * 12.34 * 0.13, 12);
  });

  it('an empty day is all zeros with known fibre', () => {
    expect(dayNutrition([])).toEqual(mealNutrition([], products));
  });

  it('mutating an empty result does not leak into later totals', () => {
    const empty = dayNutrition([]);
    empty.kcal = 500;
    empty.fibre = null;
    expect(dayNutrition([])).toEqual({ ...empty, kcal: 0, fibre: 0 });
    expect(mealNutrition([item('cucumber', 100)], products).kcal).toBeCloseTo(11, 12);
  });
});
