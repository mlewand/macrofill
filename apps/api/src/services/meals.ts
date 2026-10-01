import type { SaveMealRequest, SaveMealResponse } from '@macrofill/domain';
import type { Db } from '../db/client';
import type { Issue } from '../http/validation';
import { createRepositories, type Repositories } from '../repositories';

export type SaveMealResult =
  | { status: 'created' | 'replayed'; body: SaveMealResponse }
  | { status: 'invalid'; issues: Issue[] }
  /** The meal was saved and its entry has since been deleted (M7-4); it's not brought back. */
  | { status: 'deleted' }
  /** An id is taken by another of the user's meals or entries; never reported as success. */
  | { status: 'conflict' }
  /** M4-3: an id belongs to another user's meal or entry, which this user can't see. */
  | { status: 'not_found' }
  /** The meal was made by another user than the one logged in now. */
  | { status: 'wrong_user' };

class Conflict extends Error {}
class NotFound extends Error {}

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
      if (request.username !== undefined && request.username !== (await repos.user.username())) {
        return { status: 'wrong_user' as const };
      }
      const saved = await existing(repos, request);
      if (saved) return saved;

      const issues = await references(repos, request);
      if (issues.length > 0) return { status: 'invalid' as const, issues };

      if (!(await repos.meals.insertIfAbsent(request.meal))) {
        // Lost a race with a concurrent retry, or the id belongs to someone else.
        const raced = await existing(repos, request);
        if (raced) return raced;
        throw new NotFound();
      }
      if (
        !(await repos.consumptionEntries.insertIfAbsent(request.consumptionEntry, request.meal.id))
      ) {
        // Taken by another of the user's entries, or by someone else's.
        throw (await repos.consumptionEntries.exists(request.consumptionEntry.id))
          ? new Conflict()
          : new NotFound();
      }
      const body = await stored(repos, request.meal.id);
      if (!body) throw new Error('Saved meal not found.');
      return { status: 'created' as const, body };
    });
  } catch (error) {
    // Rolled back: nothing from this request is saved.
    if (error instanceof Conflict) return { status: 'conflict' };
    if (error instanceof NotFound) return { status: 'not_found' };
    throw error;
  }
}

/**
 * The outcome for a meal the user already saved, or undefined if there's none. If its entry was
 * deleted since (M7-4), a late retry must not bring it back.
 */
async function existing(
  repos: Repositories,
  request: SaveMealRequest,
): Promise<SaveMealResult | undefined> {
  const meal = await repos.meals.find(request.meal.id);
  if (!meal) return undefined;
  const consumptionEntry = await repos.consumptionEntries.findByMeal(meal.id);
  if (!consumptionEntry) return { status: 'deleted' };
  return replay({ meal, consumptionEntry }, request);
}

/**
 * A genuine retry resends the same ids (the client generates them once per meal). A request for a
 * stored meal naming a different entry is not a retry: it's a conflict, whoever owns that id.
 */
function replay(saved: SaveMealResponse, request: SaveMealRequest): SaveMealResult {
  if (saved.consumptionEntry.id !== request.consumptionEntry.id) throw new Conflict();
  return { status: 'replayed', body: saved };
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
