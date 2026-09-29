import { z } from 'zod';
import { idSchema, localizedTextSchema, slugSchema } from './common.js';
import { productNutritionSchema } from './nutrition.js';

export const ingredientClassSchema = z.object({
  id: slugSchema,
  name: localizedTextSchema,
});

export type IngredientClass = z.infer<typeof ingredientClassSchema>;

export const productSchema = z.object({
  id: idSchema,
  ingredientClassId: slugSchema,
  /** As printed on the package; not translated. */
  name: z.string().min(1),
  brand: z.string().min(1).optional(),
  nutrition: productNutritionSchema,
  source: z.enum(['seed', 'user']),
});

export type Product = z.infer<typeof productSchema>;

export const recipeStepSchema = z.object({
  id: idSchema,
  ingredientClassId: slugSchema,
  defaultProductId: idSchema.optional(),
});

export type RecipeStep = z.infer<typeof recipeStepSchema>;

export const recipeSchema = z.object({
  id: idSchema,
  name: localizedTextSchema,
  steps: z.array(recipeStepSchema),
});

export type Recipe = z.infer<typeof recipeSchema>;
