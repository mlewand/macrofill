import type {
  CatalogProduct,
  ConsumptionEntry,
  CreateProductRequest,
  DailyTargets,
  IngredientClass,
  LocalizedText,
  NutritionValues,
  PreparedMeal,
  PreparedMealItem,
  Recipe,
  SaveMealRequest,
  ScaleRecording,
  UsageEvent,
} from '@macrofill/domain';
import { and, asc, desc, eq, inArray, max, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  consumptionEntries,
  dailyTargets,
  ingredientClasses,
  preparedMealItems,
  preparedMeals,
  products,
  recipeSteps,
  recipes,
  scaleRecordings,
  usageEvents,
  users,
} from '../db/schema';

/**
 * Data access for one user. Every query on user-owned data is scoped by `ownerId`; nothing else
 * reads or writes those tables. Global content (ingredient classes, recipes, products) isn't.
 */
export function createRepositories(db: Db, ownerId: string) {
  return {
    user: {
      async username(): Promise<string> {
        const [user] = await db
          .select({ username: users.username })
          .from(users)
          .where(eq(users.id, ownerId));
        if (!user) throw new Error('Current user not found.');
        return user.username;
      },

      async timezone(): Promise<string> {
        const [user] = await db
          .select({ timezone: users.timezone })
          .from(users)
          .where(eq(users.id, ownerId));
        if (!user) throw new Error('Current user not found.');
        return user.timezone;
      },
    },

    dailyTargets: {
      /** The user's targets; all unset (not tracked) when there's no row. */
      async get(): Promise<DailyTargets> {
        const [row] = await db
          .select({
            protein: dailyTargets.protein,
            fat: dailyTargets.fat,
            carbs: dailyTargets.carbs,
            fibre: dailyTargets.fibre,
            kcal: dailyTargets.kcal,
          })
          .from(dailyTargets)
          .where(eq(dailyTargets.ownerId, ownerId));
        return row ?? { protein: null, fat: null, carbs: null, fibre: null, kcal: null };
      },
    },

    ingredientClasses: {
      all(): Promise<IngredientClass[]> {
        return db.select().from(ingredientClasses).orderBy(asc(ingredientClasses.id));
      },

      async exists(id: string): Promise<boolean> {
        const rows = await db
          .select({ id: ingredientClasses.id })
          .from(ingredientClasses)
          .where(eq(ingredientClasses.id, id));
        return rows.length > 0;
      },
    },

    products: {
      /** Every product, each with when the user last used it (M5-2). */
      async allWithLastUse(): Promise<CatalogProduct[]> {
        const lastUse = db
          .select({
            productId: preparedMealItems.productId,
            lastUsedAt: max(preparedMeals.finishedAt).as('last_used_at'),
          })
          .from(preparedMealItems)
          .innerJoin(preparedMeals, eq(preparedMeals.id, preparedMealItems.preparedMealId))
          .where(
            and(
              eq(preparedMealItems.ownerId, ownerId),
              eq(preparedMeals.ownerId, ownerId),
              eq(preparedMealItems.skipped, false),
            ),
          )
          .groupBy(preparedMealItems.productId)
          .as('last_use');
        const rows = await db
          .select({ product: products, lastUsedAt: lastUse.lastUsedAt })
          .from(products)
          .leftJoin(lastUse, eq(lastUse.productId, products.id))
          .orderBy(asc(products.name));
        return rows.map(({ product, lastUsedAt }) =>
          toCatalogProduct(
            product,
            lastUsedAt === null ? null : new Date(lastUsedAt).toISOString(),
          ),
        );
      },

      /**
       * The product with what a retry is compared by: its barcode, and whether this user added it.
       * Not for responses.
       */
      async find(id: string): Promise<StoredProduct | undefined> {
        const [row] = await db.select().from(products).where(eq(products.id, id));
        return row && storedProduct(row, ownerId);
      },

      /** The product with this barcode (the store's 13-digit form), or undefined (#65-3). */
      async findByBarcode(barcode: string): Promise<StoredProduct | undefined> {
        const [row] = await db.select().from(products).where(eq(products.barcode, barcode));
        return row && storedProduct(row, ownerId);
      },

      /**
       * Adds a manual product by the user (#64-4); `createdBy` comes from the session, never from
       * the request. Returns whether it was inserted: false if the id is taken (by anyone).
       */
      async insertIfAbsent(product: CreateProductRequest): Promise<boolean> {
        const { nutrition, brand, lookup, ...rest } = product;
        const inserted = await db
          .insert(products)
          .values({
            ...rest,
            brand: brand ?? null,
            ...nutrition,
            source: lookup?.source ?? 'manual',
            sourceRef: lookup?.ref ?? null,
            createdBy: ownerId,
          })
          .onConflictDoNothing()
          .returning({ id: products.id });
        return inserted.length > 0;
      },

      /** Of `ids`, those that are products. */
      async existingIds(ids: readonly string[]): Promise<Set<string>> {
        if (ids.length === 0) return new Set();
        const rows = await db
          .select({ id: products.id })
          .from(products)
          .where(inArray(products.id, [...ids]));
        return new Set(rows.map((r) => r.id));
      },
    },

    recipes: {
      async all(): Promise<Recipe[]> {
        const [recipeRows, stepRows] = await Promise.all([
          db.select().from(recipes).orderBy(asc(recipes.id)),
          db
            .select()
            .from(recipeSteps)
            .orderBy(asc(recipeSteps.recipeId), asc(recipeSteps.position)),
        ]);
        return recipeRows.map((recipe) => ({
          id: recipe.id,
          name: recipe.name,
          steps: stepRows
            .filter((step) => step.recipeId === recipe.id)
            .map((step) => ({
              id: step.id,
              ingredientClassId: step.ingredientClassId,
              ...(step.defaultProductId === null
                ? {}
                : { defaultProductId: step.defaultProductId }),
            })),
        }));
      },

      async exists(id: string): Promise<boolean> {
        const rows = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.id, id));
        return rows.length > 0;
      },
    },

    meals: {
      /** Inserts the meal unless its id is taken (by anyone). Returns whether it was inserted. */
      async insertIfAbsent(meal: PreparedMeal): Promise<boolean> {
        const inserted = await db
          .insert(preparedMeals)
          .values({
            id: meal.id,
            ownerId,
            recipeId: meal.recipeId ?? null,
            inputMethod: meal.inputMethod,
            startedAt: new Date(meal.startedAt),
            finishedAt: new Date(meal.finishedAt),
          })
          .onConflictDoNothing()
          .returning({ id: preparedMeals.id });
        if (inserted.length === 0) return false;
        if (meal.items.length > 0) {
          await db.insert(preparedMealItems).values(
            meal.items.map((item, position) => ({
              ownerId,
              preparedMealId: meal.id,
              position,
              stepId: item.stepId ?? null,
              skipped: item.skipped,
              productId: item.skipped ? null : item.productId,
              grams: item.skipped ? null : item.grams,
              weightSource: item.skipped ? null : item.weightSource,
            })),
          );
        }
        return true;
      },

      /** Weighed items of the given meals, with each product's nutrition per 100 g. */
      async weighedItems(mealIds: readonly string[]) {
        if (mealIds.length === 0) return [];
        const rows = await db
          .select({ item: preparedMealItems, product: products })
          .from(preparedMealItems)
          .innerJoin(products, eq(products.id, preparedMealItems.productId))
          .where(
            and(
              inArray(preparedMealItems.preparedMealId, [...mealIds]),
              eq(preparedMealItems.ownerId, ownerId),
              eq(preparedMealItems.skipped, false),
            ),
          );
        return rows.map(({ item, product: p }) => ({
          preparedMealId: item.preparedMealId,
          item: toItem(item),
          per100g: {
            kcal: p.kcal,
            fat: p.fat,
            saturates: p.saturates,
            carbs: p.carbs,
            sugars: p.sugars,
            protein: p.protein,
            salt: p.salt,
            fibre: p.fibre,
          } satisfies NutritionValues,
          productId: p.id,
        }));
      },

      async find(id: string): Promise<PreparedMeal | undefined> {
        const [meal] = await db
          .select()
          .from(preparedMeals)
          .where(and(eq(preparedMeals.id, id), eq(preparedMeals.ownerId, ownerId)));
        if (meal === undefined) return undefined;
        const items = await db
          .select()
          .from(preparedMealItems)
          .where(
            and(eq(preparedMealItems.preparedMealId, id), eq(preparedMealItems.ownerId, ownerId)),
          )
          .orderBy(asc(preparedMealItems.position));
        return {
          id: meal.id,
          ...(meal.recipeId === null ? {} : { recipeId: meal.recipeId }),
          inputMethod: meal.inputMethod,
          startedAt: meal.startedAt.toISOString(),
          finishedAt: meal.finishedAt.toISOString(),
          items: items.map(toItem),
        };
      },
    },

    scaleRecordings: {
      /** Stores a meal's recording (M4-7), in the transaction that saves the meal. */
      async insert(preparedMealId: string, recording: ScaleRecording): Promise<void> {
        await db.insert(scaleRecordings).values({ preparedMealId, ownerId, recording });
      },

      async find(preparedMealId: string): Promise<ScaleRecording | undefined> {
        const [row] = await db
          .select({ recording: scaleRecordings.recording })
          .from(scaleRecordings)
          .where(
            and(
              eq(scaleRecordings.preparedMealId, preparedMealId),
              eq(scaleRecordings.ownerId, ownerId),
            ),
          );
        return row?.recording;
      },
    },

    usageEvents: {
      /**
       * Stores the events as the user's. An id the user already has (a retry) is left as it is.
       * Returns false if an id is someone else's (M4-3); the caller rolls back.
       */
      async insert(events: readonly UsageEvent[]): Promise<boolean> {
        if (events.length === 0) return true;
        const inserted = await db
          .insert(usageEvents)
          .values(
            events.map((e) => ({
              id: e.id,
              ownerId,
              clientSessionId: e.clientSessionId,
              name: e.name,
              props: e.props,
              occurredAt: new Date(e.occurredAt),
              appVersion: e.appVersion,
            })),
          )
          .onConflictDoNothing({ target: usageEvents.id })
          .returning({ id: usageEvents.id });
        // UUIDs compare in lowercase, as Postgres returns them: an id may come in either case.
        const insertedIds = new Set(inserted.map((row) => row.id.toLowerCase()));
        const kept = [...new Set(events.map((e) => e.id.toLowerCase()))].filter(
          (id) => !insertedIds.has(id),
        );
        if (kept.length === 0) return true;
        const own = await db
          .select({ id: usageEvents.id })
          .from(usageEvents)
          .where(and(inArray(usageEvents.id, kept), eq(usageEvents.ownerId, ownerId)));
        return own.length === kept.length;
      },
    },

    consumptionEntries: {
      /** Inserts the entry unless its id is taken (by anyone). Returns whether it was inserted. */
      async insertIfAbsent(
        entry: SaveMealRequest['consumptionEntry'],
        preparedMealId: string,
      ): Promise<boolean> {
        const inserted = await db
          .insert(consumptionEntries)
          .values({
            id: entry.id,
            ownerId,
            preparedMealId,
            eatenAt: new Date(entry.eatenAt),
            portion: entry.portion,
          })
          .onConflictDoNothing()
          .returning({ id: consumptionEntries.id });
        return inserted.length > 0;
      },

      /** Entries eaten on `day` (YYYY-MM-DD) in `timezone`, newest first, with the recipe name. */
      async onDay(day: string, timezone: string) {
        const rows = await db
          .select({ entry: consumptionEntries, recipeName: recipes.name })
          .from(consumptionEntries)
          .innerJoin(
            preparedMeals,
            and(
              eq(preparedMeals.id, consumptionEntries.preparedMealId),
              eq(preparedMeals.ownerId, ownerId),
            ),
          )
          .leftJoin(recipes, eq(recipes.id, preparedMeals.recipeId))
          .where(
            and(
              eq(consumptionEntries.ownerId, ownerId),
              sql`(${consumptionEntries.eatenAt} at time zone ${timezone})::date = ${day}::date`,
            ),
          )
          .orderBy(desc(consumptionEntries.eatenAt), desc(consumptionEntries.id));
        return rows.map(({ entry, recipeName }) => ({
          id: entry.id,
          preparedMealId: entry.preparedMealId,
          eatenAt: entry.eatenAt.toISOString(),
          recipeName: recipeName satisfies LocalizedText | null,
        }));
      },

      /** Deletes the user's entry; returns whether there was one. The prepared meal stays. */
      async delete(id: string): Promise<boolean> {
        const deleted = await db
          .delete(consumptionEntries)
          .where(and(eq(consumptionEntries.id, id), eq(consumptionEntries.ownerId, ownerId)))
          .returning({ id: consumptionEntries.id });
        return deleted.length > 0;
      },

      /** Whether the user has an entry with this id. */
      async exists(id: string): Promise<boolean> {
        const rows = await db
          .select({ id: consumptionEntries.id })
          .from(consumptionEntries)
          .where(and(eq(consumptionEntries.id, id), eq(consumptionEntries.ownerId, ownerId)));
        return rows.length > 0;
      },

      async findByMeal(preparedMealId: string): Promise<ConsumptionEntry | undefined> {
        const [entry] = await db
          .select()
          .from(consumptionEntries)
          .where(
            and(
              eq(consumptionEntries.preparedMealId, preparedMealId),
              eq(consumptionEntries.ownerId, ownerId),
            ),
          )
          .orderBy(asc(consumptionEntries.eatenAt))
          .limit(1);
        if (entry === undefined) return undefined;
        return {
          id: entry.id,
          preparedMealId: entry.preparedMealId,
          eatenAt: entry.eatenAt.toISOString(),
          portion: entry.portion,
        };
      },
    },
  };
}

export type Repositories = ReturnType<typeof createRepositories>;

export type StoredProduct = CatalogProduct & {
  barcode: string | null;
  sourceRef: string | null;
  addedByUser: boolean;
};

function storedProduct(row: typeof products.$inferSelect, ownerId: string): StoredProduct {
  return {
    ...toCatalogProduct(row, null),
    barcode: row.barcode,
    sourceRef: row.sourceRef,
    addedByUser: row.createdBy === ownerId,
  };
}

/** The catalog's view of a product row: it leaves out who added it and the barcode. */
function toCatalogProduct(
  p: typeof products.$inferSelect,
  lastUsedAt: string | null,
): CatalogProduct {
  return {
    id: p.id,
    ingredientClassId: p.ingredientClassId,
    name: p.name,
    ...(p.brand === null ? {} : { brand: p.brand }),
    nutrition: {
      kcal: p.kcal,
      fat: p.fat,
      saturates: p.saturates,
      carbs: p.carbs,
      sugars: p.sugars,
      protein: p.protein,
      salt: p.salt,
      fibre: p.fibre,
    },
    source: p.source,
    lastUsedAt,
  };
}

function toItem(row: typeof preparedMealItems.$inferSelect): PreparedMealItem {
  const stepId = row.stepId === null ? {} : { stepId: row.stepId };
  if (row.skipped) return { ...stepId, skipped: true };
  // The database CHECK guarantees these for a weighed item.
  return {
    ...stepId,
    skipped: false,
    productId: row.productId!,
    grams: row.grams!,
    weightSource: row.weightSource!,
  };
}
