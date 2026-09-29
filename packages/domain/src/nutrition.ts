import { z } from 'zod';

const amount = z.number().nonnegative();

/**
 * Nutrition per 100 g: the full EU label set. `fibre` is `null` when unknown (EU labels don't
 * always have it), which is never the same as 0 (M2-3).
 */
export const nutritionValuesSchema = z.object({
  kcal: amount,
  fat: amount,
  saturates: amount,
  carbs: amount,
  sugars: amount,
  protein: amount,
  salt: amount,
  fibre: amount.nullable(),
});

export type NutritionValues = z.infer<typeof nutritionValuesSchema>;
export type Nutrient = keyof NutritionValues;

export const NUTRIENTS = Object.keys(nutritionValuesSchema.shape) as readonly Nutrient[];

/** Absorbs floating point error in sums of decimal label values, e.g. 100.00000000000001. */
const EPSILON = 1e-9;

/** M2-6: protein + fat + carbs + fibre + salt can't exceed 100 g per 100 g. Unknown fibre counts as 0. */
export const productNutritionSchema = nutritionValuesSchema.refine(
  (n) => n.protein + n.fat + n.carbs + (n.fibre ?? 0) + n.salt <= 100 + EPSILON,
  { message: 'Protein, fat, carbs, fibre and salt add up to more than 100 g per 100 g.' },
);
