import type { PreparedMealItem } from './meal.js';
import type { NutritionValues } from './nutrition.js';

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

/** M2-1: grams × per-100 g value / 100, for every field. Unknown fibre stays unknown. */
export function itemNutrition(per100g: NutritionValues, grams: number): NutritionValues {
  const scale = (value: number) => (grams * value) / 100;
  return {
    kcal: scale(per100g.kcal),
    fat: scale(per100g.fat),
    saturates: scale(per100g.saturates),
    carbs: scale(per100g.carbs),
    sugars: scale(per100g.sugars),
    protein: scale(per100g.protein),
    salt: scale(per100g.salt),
    fibre: per100g.fibre === null ? null : scale(per100g.fibre),
  };
}

function add(a: NutritionValues, b: NutritionValues): NutritionValues {
  return {
    kcal: a.kcal + b.kcal,
    fat: a.fat + b.fat,
    saturates: a.saturates + b.saturates,
    carbs: a.carbs + b.carbs,
    sugars: a.sugars + b.sugars,
    protein: a.protein + b.protein,
    salt: a.salt + b.salt,
    fibre: a.fibre === null || b.fibre === null ? null : a.fibre + b.fibre,
  };
}

/** Sums totals. A sum that includes unknown fibre is unknown (M2-3). */
export function sumNutrition(totals: readonly NutritionValues[]): NutritionValues {
  return totals.reduce(add, ZERO);
}

/**
 * M2-2: the sum of the meal's non-skipped items. Every non-skipped item contributes, 0 g items
 * included, so a 0 g item with unknown fibre makes the fibre total unknown.
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
