import {
  dayNutrition,
  localDay,
  mealNutrition,
  type NutritionValues,
  type Today,
} from '@macrofill/domain';
import type { Db } from '../db/client';
import { createRepositories } from '../repositories';

/** M7-1 to M7-3: the user's entries for today in their timezone, with totals and targets. */
export async function getToday(db: Db, ownerId: string, now: Date): Promise<Today> {
  const repos = createRepositories(db, ownerId);
  const timezone = await repos.user.timezone();
  const day = localDay(now, timezone);
  const [entries, targets] = await Promise.all([
    repos.consumptionEntries.onDay(day, timezone),
    repos.dailyTargets.get(),
  ]);
  const items = await repos.meals.weighedItems([...new Set(entries.map((e) => e.preparedMealId))]);
  const per100g = new Map(items.map((i) => [i.productId, i.per100g]));

  const withNutrition = entries.map((entry) => ({
    ...entry,
    // MVP0 eats whole meals, so an entry's nutrition is its meal's.
    nutrition: mealNutrition(
      items.filter((i) => i.preparedMealId === entry.preparedMealId).map((i) => i.item),
      per100g,
    ),
  }));
  const totals: NutritionValues = dayNutrition(withNutrition.map((e) => e.nutrition));
  return { timezone, day, targets, totals, entries: withNutrition };
}
