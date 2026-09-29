import type { Db } from '../db/client';
import {
  dailyTargets,
  ingredientClasses,
  products,
  recipeSteps,
  recipes,
  users,
} from '../db/schema';
import { seedData } from './data';

/**
 * M4-5: loads the seed data. Idempotent: every row is upserted by its fixed id, so running it
 * again leaves the same state. Password hashes are never written here (M4-1 sets them later).
 */
export async function seed(db: Db, data = seedData): Promise<void> {
  await db.transaction(async (tx) => {
    for (const { user, targets } of data.users) {
      const { username, timezone } = user;
      await tx
        .insert(users)
        .values(user)
        .onConflictDoUpdate({ target: users.id, set: { username, timezone } });
      await tx
        .insert(dailyTargets)
        .values({ ownerId: user.id, ...targets })
        .onConflictDoUpdate({ target: dailyTargets.ownerId, set: targets });
    }

    for (const ingredientClass of data.ingredientClasses) {
      await tx
        .insert(ingredientClasses)
        .values(ingredientClass)
        .onConflictDoUpdate({ target: ingredientClasses.id, set: ingredientClass });
    }

    for (const { nutrition, brand, ...product } of data.products) {
      const row = { ...product, brand: brand ?? null, ownerId: null, ...nutrition };
      await tx.insert(products).values(row).onConflictDoUpdate({ target: products.id, set: row });
    }

    for (const { steps, ...recipe } of data.recipes) {
      await tx
        .insert(recipes)
        .values(recipe)
        .onConflictDoUpdate({ target: recipes.id, set: recipe });
      for (const [position, { defaultProductId, ...step }] of steps.entries()) {
        const row = {
          ...step,
          recipeId: recipe.id,
          position,
          defaultProductId: defaultProductId ?? null,
        };
        await tx
          .insert(recipeSteps)
          .values(row)
          .onConflictDoUpdate({ target: recipeSteps.id, set: row });
      }
    }
  });
}
