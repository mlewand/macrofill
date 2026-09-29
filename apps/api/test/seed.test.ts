import {
  dailyTargetsSchema,
  ingredientClassSchema,
  productSchema,
  recipeSchema,
  userSchema,
  type NutritionValues,
} from '@macrofill/domain';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { queryRows, type Database } from '../src/db/client';
import * as schema from '../src/db/schema';
import { seedData } from '../src/seed/data';
import { seed } from '../src/seed/seed';
import { createMigratedTestDatabase } from './support/db';

async function dump(database: Database) {
  const tables = Object.values(schema).map((t) => getTableConfig(t).name);
  const result: Record<string, unknown[]> = {};
  for (const table of tables) {
    const rows = await queryRows<{ row: unknown }>(
      database.db,
      sql`select to_jsonb(t) as row from ${sql.identifier(table)} t`,
    );
    result[table] = rows.map((r) => JSON.stringify(r.row)).sort();
  }
  return result;
}

describe('M4-5: seed script', () => {
  let database: Database;

  beforeEach(async () => {
    database = await createMigratedTestDatabase();
  });

  afterEach(async () => {
    await database.close();
  });

  it('running it twice leaves the same state as running it once', async () => {
    await seed(database.db);
    const once = await dump(database);
    await seed(database.db);
    expect(await dump(database)).toEqual(once);
    expect(once.products).toHaveLength(seedData.products.length);
    expect(once.recipe_steps).toHaveLength(
      seedData.recipes.reduce((n, r) => n + r.steps.length, 0),
    );
  });

  it('never writes a password hash, and keeps one that was set', async () => {
    await seed(database.db);
    const [user] = seedData.users;
    await database.db.execute(
      sql`update users set password_hash = 'argon2id-hash' where id = ${user!.user.id}`,
    );
    await seed(database.db);
    const rows = await queryRows(
      database.db,
      sql`select password_hash from users where id = ${user!.user.id}`,
    );
    expect(rows).toEqual([{ password_hash: 'argon2id-hash' }]);
  });

  it('stores unknown nutrition values and unset targets as null, never 0 (M2-3)', async () => {
    await seed(database.db);
    const radish = await queryRows(
      database.db,
      sql`select salt, sugars, saturates, fibre from products where name like '%Rzodkiewka%'`,
    );
    expect(radish).toEqual([{ salt: null, sugars: null, saturates: null, fibre: null }]);
    const targets = await queryRows(database.db, sql`select * from daily_targets`);
    expect(targets).toEqual([
      {
        owner_id: seedData.users[0]!.user.id,
        protein: null,
        fat: null,
        carbs: null,
        fibre: null,
        kcal: null,
      },
    ]);
  });
});

describe('seed data', () => {
  it('is valid against the domain schemas', () => {
    for (const c of seedData.ingredientClasses) ingredientClassSchema.parse(c);
    for (const p of seedData.products) productSchema.parse(p);
    for (const r of seedData.recipes) recipeSchema.parse(r);
    for (const u of seedData.users) {
      userSchema.parse(u.user);
      dailyTargetsSchema.parse(u.targets);
    }
  });

  it('references only seeded classes and products', () => {
    const classes = new Set(seedData.ingredientClasses.map((c) => c.id));
    const products = new Map(seedData.products.map((p) => [p.id, p]));
    for (const p of seedData.products) expect(classes).toContain(p.ingredientClassId);
    for (const step of seedData.recipes.flatMap((r) => r.steps)) {
      expect(classes).toContain(step.ingredientClassId);
      if (step.defaultProductId !== undefined) {
        expect(products.get(step.defaultProductId)?.ingredientClassId).toBe(step.ingredientClassId);
      }
    }
  });

  it('has the sandwich and curd recipes from the requirements', () => {
    const steps = Object.fromEntries(
      seedData.recipes.map((r) => [r.name.en, r.steps.map((s) => s.ingredientClassId)]),
    );
    expect(steps).toEqual({
      Sandwich: ['wholegrain-bread', 'cream-cheese', 'cheese', 'ham'],
      Curd: ['curd', 'milk', 'cucumber', 'ham', 'radish'],
    });
  });

  it('uses unique ids', () => {
    const ids = [
      ...seedData.products.map((p) => p.id),
      ...seedData.recipes.flatMap((r) => [r.id, ...r.steps.map((s) => s.id)]),
      ...seedData.users.map((u) => u.user.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('product values match test_data/nutritional_example.json, mapped to domain names', () => {
    const file = JSON.parse(
      readFileSync(new URL('../../../test_data/nutritional_example.json', import.meta.url), 'utf8'),
    ) as { products: { name: string; nutrition: Record<string, number | null> }[] };
    for (const product of seedData.products) {
      const source = file.products.find((p) => p.name.endsWith(` - ${product.name}`));
      expect(source, product.name).toBeDefined();
      const n = source!.nutrition;
      const expected: NutritionValues = {
        kcal: n.kcals ?? null,
        fat: n.fat ?? null,
        saturates: n.saturatedFat ?? null,
        carbs: n.carbohydrates ?? null,
        sugars: n.sugar ?? null,
        protein: n.protein ?? null,
        salt: n.salt ?? null,
        // The file has no fibre, so it's unknown, never 0.
        fibre: null,
      };
      expect(product.nutrition, product.name).toEqual(expected);
    }
  });
});
