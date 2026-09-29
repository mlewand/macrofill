import type { LocalizedText } from '@macrofill/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// Every user-owned table has `ownerId`; curated content (classes, recipes, seed products) is global.
// Nutrient and target columns are nullable: null means unknown / not tracked, never 0.

export const users = pgTable('users', {
  id: uuid().primaryKey(),
  username: text().notNull().unique(),
  /** argon2id. Null until login exists (M4-1, Phase C). */
  passwordHash: text(),
  /** IANA name (M2-5). */
  timezone: text().notNull(),
});

export const dailyTargets = pgTable('daily_targets', {
  ownerId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  protein: doublePrecision(),
  fat: doublePrecision(),
  carbs: doublePrecision(),
  fibre: doublePrecision(),
  kcal: doublePrecision(),
});

export const ingredientClasses = pgTable('ingredient_classes', {
  id: text().primaryKey(),
  name: jsonb().$type<LocalizedText>().notNull(),
});

export const products = pgTable(
  'products',
  {
    id: uuid().primaryKey(),
    /** Null for seed products, which everyone sees. */
    ownerId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    ingredientClassId: text()
      .notNull()
      .references(() => ingredientClasses.id),
    name: text().notNull(),
    brand: text(),
    source: text({ enum: ['seed', 'user'] }).notNull(),
    kcal: doublePrecision(),
    fat: doublePrecision(),
    saturates: doublePrecision(),
    carbs: doublePrecision(),
    sugars: doublePrecision(),
    protein: doublePrecision(),
    salt: doublePrecision(),
    fibre: doublePrecision(),
  },
  (t) => [
    check('products_owner_matches_source', sql`(${t.source} = 'seed') = (${t.ownerId} is null)`),
  ],
);

export const recipes = pgTable('recipes', {
  id: uuid().primaryKey(),
  name: jsonb().$type<LocalizedText>().notNull(),
});

export const recipeSteps = pgTable(
  'recipe_steps',
  {
    id: uuid().primaryKey(),
    recipeId: uuid()
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    ingredientClassId: text()
      .notNull()
      .references(() => ingredientClasses.id),
    defaultProductId: uuid().references(() => products.id),
  },
  (t) => [unique().on(t.recipeId, t.position)],
);

export const preparedMeals = pgTable('prepared_meals', {
  id: uuid().primaryKey(),
  ownerId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  recipeId: uuid().references(() => recipes.id),
  inputMethod: text({ enum: ['scale', 'vision', 'direct'] }).notNull(),
  startedAt: timestamp({ withTimezone: true }).notNull(),
  finishedAt: timestamp({ withTimezone: true }).notNull(),
});

export const preparedMealItems = pgTable(
  'prepared_meal_items',
  {
    ownerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    preparedMealId: uuid()
      .notNull()
      .references(() => preparedMeals.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    stepId: uuid(),
    skipped: boolean().notNull(),
    productId: uuid().references(() => products.id),
    grams: doublePrecision(),
    weightSource: text({ enum: ['scale', 'manual'] }),
  },
  (t) => [
    primaryKey({ columns: [t.preparedMealId, t.position] }),
    // Mirrors the domain union: a skipped item has no product or grams; others have both, grams >= 0.
    check(
      'prepared_meal_items_skipped_shape',
      sql`(${t.skipped} and ${t.productId} is null and ${t.grams} is null and ${t.weightSource} is null)
        or (not ${t.skipped} and ${t.productId} is not null and ${t.grams} >= 0 and ${t.weightSource} is not null)`,
    ),
  ],
);

export const consumptionEntries = pgTable('consumption_entries', {
  id: uuid().primaryKey(),
  ownerId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  preparedMealId: uuid()
    .notNull()
    .references(() => preparedMeals.id, { onDelete: 'cascade' }),
  eatenAt: timestamp({ withTimezone: true }).notNull(),
  /** `{ type: 'whole' }` in MVP0; grams or a fraction later. */
  portion: jsonb().$type<{ type: 'whole' }>().notNull(),
});
