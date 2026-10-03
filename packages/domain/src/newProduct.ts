import { z } from 'zod';
import { barcodeSchema } from './barcode.js';
import { idSchema, slugSchema } from './common.js';
import { lookupSourceSchema } from './lookup.js';
import { parseGrams } from './input.js';
import { productNutritionSchema, type Nutrient, type NutritionValues } from './nutrition.js';

// Adding a product by its label (#64). The rules here are for what's written to the shared store:
// reads stay tolerant (`productSchema`), so one odd row can never block the catalog for everyone.

/** Absorbs floating point error in sums of decimal label values. */
const EPSILON = 1e-9;

/** The nutrients given in grams per 100 g; energy isn't a weight. */
const GRAM_NUTRIENTS: readonly Nutrient[] = [
  'fat',
  'saturates',
  'carbs',
  'sugars',
  'protein',
  'salt',
  'fibre',
];

export type LabelValue =
  { ok: true; value: number | null } | { ok: false; reason: 'negative' | 'invalid' | 'tooLarge' };

/**
 * #64-1, #64-2: one typed label value, per 100 g. Empty means unknown (`null`), never 0. Accepts
 * `3,2` and `3.2`, rejects negative and malformed input, and a gram value above 100.
 */
export function parseLabelValue(nutrient: Nutrient, input: string): LabelValue {
  const parsed = parseGrams(input);
  if (!parsed.ok) {
    return parsed.reason === 'empty'
      ? { ok: true, value: null }
      : { ok: false, reason: parsed.reason };
  }
  if (GRAM_NUTRIENTS.includes(nutrient) && parsed.grams > 100) {
    return { ok: false, reason: 'tooLarge' };
  }
  return { ok: true, value: parsed.grams };
}

/**
 * #64-3: the energy the macros add up to (4 kcal per g of protein and carbs, 9 per g of fat, 2 per
 * g of fibre) when the label's kcal is further from it than max(15% of that, 10 kcal). Undefined
 * when it's close enough, or when kcal, protein, carbs, fat or fibre is unknown: the check needs
 * them all.
 */
export function kcalMismatch(nutrition: NutritionValues): { expected: number } | undefined {
  const { kcal, protein, carbs, fat, fibre } = nutrition;
  if (kcal === null || protein === null || carbs === null || fat === null || fibre === null) {
    return undefined;
  }
  const expected = 4 * protein + 4 * carbs + 9 * fat + 2 * fibre;
  return Math.abs(kcal - expected) > Math.max(0.15 * expected, 10) ? { expected } : undefined;
}

/**
 * #69-1: on a label, sugars are part of the carbs and saturates part of the fat, so a part above
 * its whole is a typo. Returns the fields that are wrong, the parts (`sugars`, `saturates`), in
 * that order. Comparing with an unknown value is skipped; a known 0 is a value.
 */
export function partOfWholeProblems(nutrition: NutritionValues): ('sugars' | 'saturates')[] {
  const problems: ('sugars' | 'saturates')[] = [];
  const { sugars, carbs, saturates, fat } = nutrition;
  if (sugars !== null && carbs !== null && sugars > carbs + EPSILON) problems.push('sugars');
  if (saturates !== null && fat !== null && saturates > fat + EPSILON) problems.push('saturates');
  return problems;
}

/** #64-2, #69-1: the values a product can be written with. */
const newProductNutritionSchema = productNutritionSchema
  .refine((n) => GRAM_NUTRIENTS.every((nutrient) => (n[nutrient] ?? 0) <= 100 + EPSILON), {
    message: 'A value is above 100 g per 100 g.',
  })
  .refine((n) => (n.carbs ?? 0) + (n.protein ?? 0) + (n.fat ?? 0) <= 100 + EPSILON, {
    message: 'Carbs, protein and fat add up to more than 100 g per 100 g.',
  })
  .superRefine((n, ctx) => {
    // Each part is reported on its own field, so a client can show it there.
    for (const part of partOfWholeProblems(n)) {
      ctx.addIssue({
        code: 'custom',
        path: [part],
        message:
          part === 'sugars'
            ? 'Sugars are part of the carbs and can’t be more than them.'
            : 'Saturates are part of the fat and can’t be more than it.',
      });
    }
  });

/** `POST /api/products` (#64-1, #64-8). The id is the client's, so a retry is safe. */
export const createProductRequestSchema = z.object({
  id: idSchema,
  ingredientClassId: slugSchema,
  /** As printed on the package; not translated. */
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().min(1).max(200).optional(),
  /** The store's 13-digit form (#63-2), already normalized by the client (#65-2). */
  barcode: barcodeSchema.optional(),
  nutrition: newProductNutritionSchema,
  /** The product came from a provider's candidate (#66-3): saved with that source and reference. */
  lookup: z.object({ source: lookupSourceSchema, ref: z.string().min(1).max(100) }).optional(),
});

export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;
