import { z } from 'zod';
import { idSchema, localizedTextSchema, timestampSchema } from './common.js';
import { dailyTargetsSchema, type DailyTargets } from './meal.js';
import { nutritionValuesSchema, type NutritionValues } from './nutrition.js';
import { timeZoneSchema } from './time.js';

/** The nutrients tracked against daily targets, in display order. */
export const TRACKED_NUTRIENTS = ['protein', 'fat', 'carbs', 'fibre', 'kcal'] as const;

export type TrackedNutrient = (typeof TRACKED_NUTRIENTS)[number];

export interface NutrientProgress {
  nutrient: TrackedNutrient;
  /** `null` when unknown (M2-3). */
  consumed: number | null;
  /** `null` when not tracked. */
  target: number | null;
  /** Target minus consumed, unrounded; negative when over. `null` without a target, or when unknown. */
  remaining: number | null;
}

/** M7-2: consumed, target and remaining per tracked nutrient. */
export function targetProgress(
  consumed: NutritionValues,
  targets: DailyTargets,
): NutrientProgress[] {
  return TRACKED_NUTRIENTS.map((nutrient) => {
    const eaten = consumed[nutrient];
    const target = targets[nutrient];
    return {
      nutrient,
      consumed: eaten,
      target,
      remaining: target === null || eaten === null ? null : target - eaten,
    };
  });
}

export const todayEntrySchema = z.object({
  id: idSchema,
  preparedMealId: idSchema,
  eatenAt: timestampSchema,
  /** `null` for a meal without a recipe. */
  recipeName: localizedTextSchema.nullable(),
  nutrition: nutritionValuesSchema,
});

export type TodayEntry = z.infer<typeof todayEntrySchema>;

/** `GET /api/today` (M7-1 to M7-3): the user's day, in the user's timezone. */
export const todaySchema = z.object({
  timezone: timeZoneSchema,
  /** The calendar day in `timezone`, `YYYY-MM-DD`. */
  day: z.iso.date(),
  targets: dailyTargetsSchema,
  totals: nutritionValuesSchema,
  /** Newest first. */
  entries: z.array(todayEntrySchema),
});

export type Today = z.infer<typeof todaySchema>;
