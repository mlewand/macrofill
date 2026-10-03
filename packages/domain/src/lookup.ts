import { z } from 'zod';
import { nutritionValuesSchema } from './nutrition.js';

// Looking a barcode up in public product databases (#66). The api asks the providers; the web app
// only sees this shape.

/** What one provider came to for one barcode. */
export const lookupResultSchema = z.enum(['hit', 'miss', 'error', 'timeout']);
export type LookupResult = z.infer<typeof lookupResultSchema>;

/** One provider's try, for the answer and for the usage event (#66-6, #67-4). */
export const lookupAttemptSchema = z.object({
  /** The provider's id, e.g. `openfoodfacts`. */
  provider: z.string().min(1).max(32),
  result: lookupResultSchema,
});
export type LookupAttempt = z.infer<typeof lookupAttemptSchema>;

/**
 * A product as a provider describes it, to prefill the form (#66-2). Values the provider lacks are
 * `null`, never 0 (M2-3). It's checked and stored only once the user saves it.
 */
export const productCandidateSchema = z.object({
  /** Read tolerantly: a newer api may know providers this build doesn't. */
  source: z.string().min(1),
  /** The provider's own reference for the product. */
  sourceRef: z.string().min(1).max(100),
  /** As the provider has it; may be empty. */
  name: z.string(),
  brand: z.string().min(1).optional(),
  nutrition: nutritionValuesSchema,
});
export type ProductCandidate = z.infer<typeof productCandidateSchema>;

/** `GET /api/product-lookup/:code`: the candidate if a provider had one, and who was asked. */
export const lookupResponseSchema = z.object({
  candidate: productCandidateSchema.optional(),
  attempts: z.array(lookupAttemptSchema).max(10),
});
export type LookupResponse = z.infer<typeof lookupResponseSchema>;

/** The providers a product can be saved as coming from: what this build writes (#66-3). */
export const lookupSourceSchema = z.enum(['openfoodfacts']);
export type LookupSource = z.infer<typeof lookupSourceSchema>;
