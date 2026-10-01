import { z } from 'zod';
import { idSchema, timestampSchema } from './common.js';
import { scaleRecordingSchema } from './recording.js';

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

/**
 * `POST /api/meals` body: a meal and its consumption entry. Both ids are client-generated, so a
 * retried save is idempotent (M4-6). The entry belongs to this meal; it names no meal itself.
 */
export const saveMealRequestSchema = z.object({
  meal: preparedMealSchema,
  consumptionEntry: consumptionEntrySchema.omit({ preparedMealId: true }),
  /**
   * The user the meal was made by, as the client knows them. A session of another user refuses it,
   * so a meal never lands in the wrong account when the login changes meanwhile (another tab).
   */
  username: z.string().min(1).optional(),
  /** M6-7: a meal weighed with the scale comes with its recording (M3-11), stored with it (M4-7). */
  recording: scaleRecordingSchema.optional(),
});

export type SaveMealRequest = z.infer<typeof saveMealRequestSchema>;

/** `POST /api/meals` response: the meal and entry as stored. */
export const saveMealResponseSchema = z.object({
  meal: preparedMealSchema,
  consumptionEntry: consumptionEntrySchema,
});

export type SaveMealResponse = z.infer<typeof saveMealResponseSchema>;

const target = z.number().nonnegative().nullable();

/**
 * Each target can be unset: `null` means not tracked, never 0, and the other targets stay tracked.
 * All five keys are required; only their values are nullable.
 */
export const dailyTargetsSchema = z.object({
  protein: target,
  fat: target,
  carbs: target,
  fibre: target,
  kcal: target,
});

export type DailyTargets = z.infer<typeof dailyTargetsSchema>;
