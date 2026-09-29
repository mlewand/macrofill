import type {
  ConsumptionEntry,
  PreparedMeal,
  PreparedMealItem,
  SaveMealRequest,
} from '@macrofill/domain';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  consumptionEntries,
  preparedMealItems,
  preparedMeals,
  products,
  recipes,
} from '../db/schema';

/**
 * Data access for one user. Every query on user-owned data is scoped by `ownerId`; nothing else
 * reads or writes those tables. Curated content (recipes, seed products) is global.
 */
export function createRepositories(db: Db, ownerId: string) {
  return {
    products: {
      /** Of `ids`, those the user may use: seed products and the user's own. */
      async visibleIds(ids: readonly string[]): Promise<Set<string>> {
        if (ids.length === 0) return new Set();
        const rows = await db
          .select({ id: products.id })
          .from(products)
          .where(
            and(
              inArray(products.id, [...ids]),
              or(isNull(products.ownerId), eq(products.ownerId, ownerId)),
            ),
          );
        return new Set(rows.map((r) => r.id));
      },
    },

    recipes: {
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
