import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  dailyTargets,
  ingredientClasses,
  products,
  recipeSteps,
  recipes,
  users,
} from '../db/schema';
import { assertSettablePassword, hashPassword } from '../auth/password';
import { createAuthRepository } from '../repositories/auth';
import { seedData } from './data';

/** Initial passwords by username, from `SEED_PASSWORD_<USERNAME>` (see `seedPasswordsFromEnv`). */
export type SeedPasswords = Readonly<Record<string, string>>;

/** The env variable with a user's initial password: `mlewand` → `SEED_PASSWORD_MLEWAND`. */
export function seedPasswordVariable(username: string): string {
  return `SEED_PASSWORD_${username.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

/** The initial passwords set in `env` for the seed's users. */
export function seedPasswordsFromEnv(
  env: Record<string, string | undefined>,
  data = seedData,
): Record<string, string> {
  const passwords: Record<string, string> = {};
  const owners = new Map<string, string>();
  for (const { user } of data.users) {
    const variable = seedPasswordVariable(user.username);
    const other = owners.get(variable);
    // Two users must never share an initial password by accident.
    if (other !== undefined) {
      throw new Error(`Users ${other} and ${user.username} would both use ${variable}.`);
    }
    owners.set(variable, user.username);
    const password = env[variable];
    if (password !== undefined && password !== '') passwords[user.username] = password;
  }
  return passwords;
}

/**
 * M4-5: loads the seed data. Idempotent: every row is upserted by its fixed id, so running it
 * again leaves the same state.
 *
 * #63-7: products are loaded only into an empty product store. Once it holds any, products
 * are shared content that users add to and the seed file's products are left alone: no update,
 * no new one. A recipe step whose default product isn't in the store then loses that default
 * (the rest is seeded), and its id is returned in `missingDefaultProducts`.
 *
 * M4-1: `passwords` are initial passwords. One is hashed and stored only for a user who has no
 * password yet, so running the seed again keeps the hash, and a password reset survives deploys.
 * Returns the users who still have no password (they can't log in).
 */
export async function seed(
  db: Db,
  data = seedData,
  passwords: SeedPasswords = {},
): Promise<{ withoutPassword: string[]; missingDefaultProducts: string[] }> {
  return db.transaction(async (tx) => {
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

    const [existing] = await tx.select({ id: products.id }).from(products).limit(1);
    if (existing === undefined) {
      for (const { nutrition, brand, ...product } of data.products) {
        // Whatever the seed file says, these are the seed's own products.
        const row = { ...product, source: 'seed' as const, brand: brand ?? null, ...nutrition };
        await tx.insert(products).values(row);
      }
    }
    const wanted = [
      ...new Set(data.recipes.flatMap((r) => r.steps.map((s) => s.defaultProductId))),
    ].filter((id): id is string => id !== undefined);
    const present = new Set(
      wanted.length === 0
        ? []
        : (
            await tx.select({ id: products.id }).from(products).where(inArray(products.id, wanted))
          ).map((r) => r.id),
    );
    const missingDefaultProducts = wanted.filter((id) => !present.has(id));

    for (const { steps, ...recipe } of data.recipes) {
      await tx
        .insert(recipes)
        .values(recipe)
        .onConflictDoUpdate({ target: recipes.id, set: recipe });
      // Steps no longer in the seed go (meal items keep their stepId; it has no foreign key).
      // The rest move out of the way first, so reordered or inserted steps don't collide on
      // (recipe_id, position) while they're upserted one by one.
      await tx.delete(recipeSteps).where(
        and(
          eq(recipeSteps.recipeId, recipe.id),
          notInArray(
            recipeSteps.id,
            steps.map((s) => s.id),
          ),
        ),
      );
      await tx
        .update(recipeSteps)
        .set({ position: sql`-${recipeSteps.position} - 1` })
        .where(eq(recipeSteps.recipeId, recipe.id));
      for (const [position, { defaultProductId, ...step }] of steps.entries()) {
        const row = {
          ...step,
          recipeId: recipe.id,
          position,
          defaultProductId:
            defaultProductId !== undefined && present.has(defaultProductId)
              ? defaultProductId
              : null,
        };
        await tx
          .insert(recipeSteps)
          .values(row)
          .onConflictDoUpdate({ target: recipeSteps.id, set: row });
      }
    }

    const auth = createAuthRepository(tx);
    const withoutPassword: string[] = [];
    for (const { user } of data.users) {
      const password = passwords[user.username];
      // Hashing takes a while on purpose, so only for a user without a password.
      if ((await auth.userByUsername(user.username))?.passwordHash != null) continue;
      if (password === undefined) {
        withoutPassword.push(user.username);
        continue;
      }
      // Checked only when it's set; throwing rolls the whole seed back.
      assertSettablePassword(password);
      await auth.setInitialPasswordHash(user.username, await hashPassword(password));
    }
    return { withoutPassword, missingDefaultProducts };
  });
}
