import { z } from 'zod';
import { idSchema, timestampSchema } from './common.js';

export const skippedItemSchema = z.object({
  stepId: idSchema.optional(),
  skipped: z.literal(true),
});

export const weighedItemSchema = z.object({
  stepId: idSchema.optional(),
  skipped: z.literal(false),
  productId: idSchema,
  /** M2-2: never negative. Net removal of an ingredient is deferred. */
  grams: z.number().nonnegative(),
  weightSource: z.enum(['scale', 'manual']),
});

// Strict, so a skipped item can't carry a product or grams.
export const preparedMealItemSchema = z.discriminatedUnion('skipped', [
  skippedItemSchema.strict(),
  weighedItemSchema.strict(),
]);

export type PreparedMealItem = z.infer<typeof preparedMealItemSchema>;

export const preparedMealSchema = z.object({
  id: idSchema,
  recipeId: idSchema.optional(),
  inputMethod: z.enum(['scale', 'vision', 'direct']),
  startedAt: timestampSchema,
  finishedAt: timestampSchema,
  items: z.array(preparedMealItemSchema),
});

export type PreparedMeal = z.infer<typeof preparedMealSchema>;

/** MVP0 always eats the whole meal. Parts of a meal (grams or a fraction) are future work. */
export const portionSchema = z.object({ type: z.literal('whole') });

export const consumptionEntrySchema = z.object({
  id: idSchema,
  preparedMealId: idSchema,
  eatenAt: timestampSchema,
  portion: portionSchema,
});

export type ConsumptionEntry = z.infer<typeof consumptionEntrySchema>;

const target = z.number().nonnegative().nullable();

/** Each target is optional: `null` means not tracked, never 0. */
export const dailyTargetsSchema = z.object({
  protein: target,
  fat: target,
  carbs: target,
  fibre: target,
  kcal: target,
});

export type DailyTargets = z.infer<typeof dailyTargetsSchema>;
