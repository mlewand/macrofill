import { z } from 'zod';

/** `null` when the label or source doesn't state it, which is never the same as 0 (M2-3). */
const amount = z.number().nonnegative().nullable();

/** Nutrition per 100 g: the full EU label set. Every key is required; any value can be unknown. */
export const nutritionValuesSchema = z.object({
  kcal: amount,
  fat: amount,
  saturates: amount,
  carbs: amount,
  sugars: amount,
  protein: amount,
  salt: amount,
  fibre: amount,
});

export type NutritionValues = z.infer<typeof nutritionValuesSchema>;
export type Nutrient = keyof NutritionValues;

export const NUTRIENTS = Object.keys(nutritionValuesSchema.shape) as readonly Nutrient[];

/** Absorbs floating point error in sums of decimal label values, e.g. 100.00000000000001. */
const EPSILON = 1e-9;

/** M2-6: protein + fat + carbs + fibre + salt can't exceed 100 g per 100 g. Unknown values count as 0. */
export const productNutritionSchema = nutritionValuesSchema.refine(
  (n) =>
    (n.protein ?? 0) + (n.fat ?? 0) + (n.carbs ?? 0) + (n.fibre ?? 0) + (n.salt ?? 0) <=
    100 + EPSILON,
  { message: 'Protein, fat, carbs, fibre and salt add up to more than 100 g per 100 g.' },
);
