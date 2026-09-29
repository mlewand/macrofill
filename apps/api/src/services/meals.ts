import type { SaveMealRequest, SaveMealResponse } from '@macrofill/domain';
import type { Db } from '../db/client';
import type { Issue } from '../http/validation';
import { createRepositories, type Repositories } from '../repositories';

export type SaveMealResult =
  | { status: 'created' | 'replayed'; body: SaveMealResponse }
  | { status: 'invalid'; issues: Issue[] }
  /** An id is taken by a meal or entry the user can't see; never reported as success. */
  | { status: 'conflict' };

class Conflict extends Error {}

/**
 * Saves a prepared meal and its consumption entry (M5-7). Idempotent through the client-generated
 * ids (M4-6): a retry of a saved meal returns it as stored, and creates nothing.
 */
export async function saveMeal(
  db: Db,
  ownerId: string,
  request: SaveMealRequest,
): Promise<SaveMealResult> {
  try {
    return await db.transaction(async (tx) => {
      const repos = createRepositories(tx, ownerId);
      const saved = await stored(repos, request.meal.id);
      if (saved) return { status: 'replayed' as const, body: saved };

      const issues = await references(repos, request);
      if (issues.length > 0) return { status: 'invalid' as const, issues };

      if (!(await repos.meals.insertIfAbsent(request.meal))) {
        // Lost a race with a concurrent retry, or the id belongs to someone else.
        const raced = await stored(repos, request.meal.id);
        if (raced) return { status: 'replayed' as const, body: raced };
        throw new Conflict();
      }
      if (
        !(await repos.consumptionEntries.insertIfAbsent(request.consumptionEntry, request.meal.id))
      ) {
        throw new Conflict();
      }
      const body = await stored(repos, request.meal.id);
      if (!body) throw new Error('Saved meal not found.');
      return { status: 'created' as const, body };
    });
  } catch (error) {
    // Rolled back: nothing from this request is saved.
    if (error instanceof Conflict) return { status: 'conflict' };
    throw error;
  }
}

async function stored(repos: Repositories, mealId: string): Promise<SaveMealResponse | undefined> {
  const meal = await repos.meals.find(mealId);
  if (!meal) return undefined;
  const consumptionEntry = await repos.consumptionEntries.findByMeal(mealId);
  if (!consumptionEntry) return undefined;
  return { meal, consumptionEntry };
}

/** Recipe and products must exist and be visible to the user. */
async function references(repos: Repositories, { meal }: SaveMealRequest): Promise<Issue[]> {
  const issues: Issue[] = [];
  if (meal.recipeId !== undefined && !(await repos.recipes.exists(meal.recipeId))) {
    issues.push({ path: 'meal.recipeId', message: 'Unknown recipe.' });
  }
  const productIds = meal.items.flatMap((item) => (item.skipped ? [] : [item.productId]));
  const visible = await repos.products.visibleIds(productIds);
  meal.items.forEach((item, index) => {
    if (!item.skipped && !visible.has(item.productId)) {
      issues.push({ path: `meal.items.${index}.productId`, message: 'Unknown product.' });
    }
  });
  return issues;
}
