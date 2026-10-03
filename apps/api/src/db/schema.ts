import {
  PRODUCT_SOURCES,
  preparedMealSchema,
  weighedItemSchema,
  type LocalizedText,
  type ScaleRecording,
} from '@macrofill/domain';
import { sql, type AnyColumn } from 'drizzle-orm';
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

// Every user-owned table has `ownerId`; global content (classes, recipes, products) has none.
// Nutrient and target columns are nullable: null means unknown / not tracked, never 0.

// `text({ enum })` narrows only the TypeScript type, so the database checks the values too.
// They come from the domain enums; changing one there needs a new migration.
const productSources = nonEmpty(PRODUCT_SOURCES);
const inputMethods = nonEmpty(preparedMealSchema.shape.inputMethod.options);
const weightSources = nonEmpty(weighedItemSchema.shape.weightSource.options);

function nonEmpty<T extends string>(values: readonly T[]): [T, ...T[]] {
  const [first, ...rest] = values;
  if (first === undefined) throw new Error('An enum needs at least one value.');
  return [first, ...rest];
}

function oneOf(column: AnyColumn, values: readonly string[]) {
  return sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`;
}

export const users = pgTable('users', {
  id: uuid().primaryKey(),
  username: text().notNull().unique(),
  /** argon2id, encoded (M4-1). Null until the seed or the password command sets one. */
  passwordHash: text(),
  /** IANA name (M2-5). */
  timezone: text().notNull(),
});

/**
 * Login sessions (M4-1). The cookie holds a random token; only its SHA-256 is stored, so a
 * database dump can't be replayed as a login.
 */
export const sessions = pgTable('sessions', {
  id: text().primaryKey(),
  ownerId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp({ withTimezone: true }).notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
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
    ingredientClassId: text()
      .notNull()
      .references(() => ingredientClasses.id),
    name: text().notNull(),
    brand: text(),
    source: text({ enum: productSources }).notNull(),
    /** The provider's own reference, when the product came from one. */
    sourceRef: text(),
    /** One 13-digit form: EAN-13 as is, UPC-A and EAN-8 left-padded with zeros (#63-2). */
    barcode: text().unique(),
    /**
     * Who added the product. Kept for the maintainer only: no response shows it. It is not an
     * ownership scope: products are global, so the user's deletion clears it and the product stays.
     */
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
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
    check('products_source_values', oneOf(t.source, productSources)),
    check('products_barcode_form', sql`${t.barcode} ~ '^[0-9]{13}$'`),
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

export const preparedMeals = pgTable(
  'prepared_meals',
  {
    id: uuid().primaryKey(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recipeId: uuid().references(() => recipes.id),
    inputMethod: text({ enum: inputMethods }).notNull(),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    finishedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [check('prepared_meals_input_method_values', oneOf(t.inputMethod, inputMethods))],
);

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
    weightSource: text({ enum: weightSources }),
  },
  (t) => [
    primaryKey({ columns: [t.preparedMealId, t.position] }),
    check('prepared_meal_items_weight_source_values', oneOf(t.weightSource, weightSources)),
    // Mirrors the domain union: a skipped item has no product or grams; others have both, grams >= 0.
    // Every predicate is null-safe: a CHECK that evaluates to NULL passes.
    check(
      'prepared_meal_items_skipped_shape',
      sql`(${t.skipped} and ${t.productId} is null and ${t.grams} is null and ${t.weightSource} is null)
        or (not ${t.skipped} and ${t.productId} is not null and ${t.grams} is not null and ${t.grams} >= 0 and ${t.weightSource} is not null)`,
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

/** M4-7: a meal's scale recording (M3-11), stored as sent; read back only for export. */
export const scaleRecordings = pgTable('scale_recordings', {
  preparedMealId: uuid()
    .primaryKey()
    .references(() => preparedMeals.id, { onDelete: 'cascade' }),
  ownerId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  recording: jsonb().$type<ScaleRecording>().notNull(),
});

/**
 * M7-8, M4-10: first-party usage events, per user. Ids come from the client, so retries store each
 * once.
 */
export const usageEvents = pgTable('usage_events', {
  id: uuid().primaryKey(),
  ownerId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  clientSessionId: uuid().notNull(),
  name: text().notNull(),
  props: jsonb().$type<Record<string, unknown>>().notNull(),
  occurredAt: timestamp({ withTimezone: true }).notNull(),
  appVersion: text().notNull(),
});
