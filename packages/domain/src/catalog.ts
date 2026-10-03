import { z } from 'zod';
import { idSchema, localizedTextSchema, slugSchema, timestampSchema } from './common.js';
import { productNutritionSchema } from './nutrition.js';

export const ingredientClassSchema = z.object({
  id: slugSchema,
  name: localizedTextSchema,
});

export type IngredientClass = z.infer<typeof ingredientClassSchema>;

/** Every source a product can be stored with; the database checks it. Providers join as added. */
export const PRODUCT_SOURCES = ['seed', 'manual', 'openfoodfacts', 'usda-fdc'] as const;

export const productSchema = z.object({
  id: idSchema,
  ingredientClassId: slugSchema,
  /** As printed on the package; not translated. */
  name: z.string().min(1),
  brand: z.string().min(1).optional(),
  nutrition: productNutritionSchema,
  /**
   * Where the product came from, see `PRODUCT_SOURCES`. Read tolerantly: a build that doesn't know
   * a newer provider must still load a catalog that has its products.
   */
  source: z.string().min(1),
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

/** A product in the catalog, with when the current user last used it (M5-2). */
export const catalogProductSchema = productSchema.extend({
  /** Finish time of the user's latest meal with this product; `null` if never used. */
  lastUsedAt: timestampSchema.nullable(),
});

export type CatalogProduct = z.infer<typeof catalogProductSchema>;

/** `GET /api/catalog`: everything the Direct Entry flow needs (M5-1, M5-2). */
export const catalogSchema = z.object({
  ingredientClasses: z.array(ingredientClassSchema),
  recipes: z.array(recipeSchema),
  products: z.array(catalogProductSchema),
});

export type Catalog = z.infer<typeof catalogSchema>;
