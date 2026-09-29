import type { PreparedMealItem } from './meal.js';
import { NUTRIENTS, type NutritionValues } from './nutrition.js';

// Calculations never round (M2-4); see format.ts for display.

const ZERO: NutritionValues = {
  kcal: 0,
  fat: 0,
  saturates: 0,
  carbs: 0,
  sugars: 0,
  protein: 0,
  salt: 0,
  fibre: 0,
};

/** M2-1: grams × per-100 g value / 100, for every field. Unknown values stay unknown (M2-3). */
export function itemNutrition(per100g: NutritionValues, grams: number): NutritionValues {
  const result = { ...ZERO };
  for (const nutrient of NUTRIENTS) {
    const value = per100g[nutrient];
    result[nutrient] = value === null ? null : (grams * value) / 100;
  }
  return result;
}

/** Sums totals per nutrient. A nutrient's sum that includes an unknown value is unknown (M2-3). */
export function sumNutrition(totals: readonly NutritionValues[]): NutritionValues {
  const result = { ...ZERO };
  for (const total of totals) {
    for (const nutrient of NUTRIENTS) {
      const sum = result[nutrient];
      const value = total[nutrient];
      result[nutrient] = sum === null || value === null ? null : sum + value;
    }
  }
  return result;
}

/**
 * M2-2: the sum of the meal's non-skipped items. Every non-skipped item contributes, 0 g items
 * included, so a 0 g item with an unknown value makes that nutrient's total unknown.
 */
export function mealNutrition(
  items: readonly PreparedMealItem[],
  per100gByProductId: ReadonlyMap<string, NutritionValues>,
): NutritionValues {
  return sumNutrition(
    items.flatMap((item) => {
      if (item.skipped) return [];
      const per100g = per100gByProductId.get(item.productId);
      if (!per100g) throw new Error(`No nutrition values for product ${item.productId}.`);
      return [itemNutrition(per100g, item.grams)];
    }),
  );
}

/** A day's total: the sum of its consumption entries' meal totals (MVP0 eats whole meals). */
export function dayNutrition(mealTotals: readonly NutritionValues[]): NutritionValues {
  return sumNutrition(mealTotals);
}
