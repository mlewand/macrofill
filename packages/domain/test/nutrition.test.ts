import { describe, expect, it } from 'vitest';
import {
  NUTRIENTS,
  nutritionValuesSchema,
  productSchema,
  type NutritionValues,
  type Nutrient,
} from '../src/index.js';

const curd: NutritionValues = {
  kcal: 119,
  fat: 4.2,
  saturates: 2.8,
  carbs: 3.4,
  sugars: 3.0,
  protein: 17.0,
  salt: 0.1,
  fibre: null,
};

const product = {
  id: '4f0c7a3e-3b8e-4d7a-9a51-6c1f2d9e8b01',
  ingredientClassId: 'curd',
  name: 'Polmlek Twaróg półtłusty',
  nutrition: curd,
  source: 'seed',
};

function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return result.error?.issues.map((i) => i.path.join('.')) ?? [];
}

describe('NutritionValues', () => {
  it('lists every stored nutrient', () => {
    expect([...NUTRIENTS].sort()).toEqual(
      ['carbs', 'fat', 'fibre', 'kcal', 'protein', 'salt', 'saturates', 'sugars'].sort(),
    );
  });

  it('M2-3: stores missing fibre as unknown (null), distinct from 0', () => {
    expect(nutritionValuesSchema.parse(curd).fibre).toBeNull();
    expect(nutritionValuesSchema.parse({ ...curd, fibre: 0 }).fibre).toBe(0);
  });

  it('M2-3: requires fibre to be stated, so a missing value is never read as 0', () => {
    const withoutFibre = Object.fromEntries(Object.entries(curd).filter(([k]) => k !== 'fibre'));
    expect(nutritionValuesSchema.safeParse(withoutFibre).success).toBe(false);
  });
});

describe('M2-6: product validation', () => {
  it('accepts a real label', () => {
    expect(productSchema.safeParse(product).success).toBe(true);
  });

  it.each(NUTRIENTS.map((n) => [n]))('rejects a negative %s', (nutrient: Nutrient) => {
    const result = productSchema.safeParse({
      ...product,
      nutrition: { ...curd, [nutrient]: -0.1 },
    });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain(`nutrition.${nutrient}`);
  });

  it('rejects protein + fat + carbs + fibre + salt above 100 g', () => {
    const result = productSchema.safeParse({
      ...product,
      nutrition: { ...curd, protein: 40, fat: 30, carbs: 20, fibre: 9, salt: 1.1 },
    });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('nutrition');
  });

  it('accepts a sum of exactly 100 g, even when floating point overshoots it', () => {
    // These add up to 100.00000000000001 in binary floating point.
    const nutrition = { ...curd, protein: 0.1, fat: 41.1, carbs: 41.1, fibre: 17.7, salt: 0 };
    const sum =
      nutrition.protein + nutrition.fat + nutrition.carbs + nutrition.fibre + nutrition.salt;
    expect(sum).not.toBe(100);
    expect(Math.abs(sum - 100)).toBeLessThan(1e-9);
    expect(productSchema.safeParse({ ...product, nutrition }).success).toBe(true);
  });

  it('rejects a sum just above 100 g', () => {
    const nutrition = { ...curd, protein: 70, fat: 29.9, carbs: 0.11, fibre: 0, salt: 0 };
    expect(productSchema.safeParse({ ...product, nutrition }).success).toBe(false);
  });

  it('counts unknown fibre as 0 in the sum', () => {
    const nutrition = { ...curd, protein: 50, fat: 30, carbs: 19.9, fibre: null, salt: 0.1 };
    expect(productSchema.safeParse({ ...product, nutrition }).success).toBe(true);
  });

  it('does not count saturates, sugars or kcal in the sum', () => {
    const nutrition = { ...curd, protein: 50, fat: 30, carbs: 20, fibre: 0, salt: 0 };
    expect(
      productSchema.safeParse({
        ...product,
        nutrition: { ...nutrition, saturates: 30, sugars: 20, kcal: 900 },
      }).success,
    ).toBe(true);
  });
});
