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

  it('reseeding after a step is inserted mid-recipe moves the later steps', async () => {
    await seed(database.db);
    const [recipe, ...otherRecipes] = seedData.recipes;
    const [first, ...rest] = recipe!.steps;
    const inserted = { id: 'f1b2c3d4-0000-4000-8000-000000000001', ingredientClassId: 'cheese' };
    const changed = {
      ...seedData,
      recipes: [{ ...recipe!, steps: [first!, inserted, ...rest] }, ...otherRecipes],
    };
    await seed(database.db, changed);
    const rows = await queryRows<{ id: string }>(
      database.db,
      sql`select id from recipe_steps where recipe_id = ${recipe!.id} order by position`,
    );
    expect(rows.map((r) => r.id)).toEqual([first!.id, inserted.id, ...rest.map((s) => s.id)]);
  });

  it('reseeding after a step is removed drops it from the recipe', async () => {
    await seed(database.db);
    const [recipe, ...otherRecipes] = seedData.recipes;
    const [first, , ...rest] = recipe!.steps;
    const changed = {
      ...seedData,
      recipes: [{ ...recipe!, steps: [first!, ...rest] }, ...otherRecipes],
    };
    await seed(database.db, changed);
    const rows = await queryRows<{ id: string; position: number }>(
      database.db,
      sql`select id, position from recipe_steps where recipe_id = ${recipe!.id} order by position`,
    );
    expect(rows).toEqual([first!, ...rest].map((s, position) => ({ id: s.id, position })));
  });

  it('#63-7: a store that already holds products is not seeded with products again', async () => {
    await seed(database.db);
    const [first, ...rest] = seedData.products;
    // Someone changed a product in the app, and the seed file has a changed and a new one.
    await database.db.execute(sql`update products set name = 'Renamed' where id = ${first!.id}`);
    const newProduct = { ...first!, id: 'a1b2c3d4-0000-4000-8000-0000000000aa', name: 'New' };
    const changed = {
      ...seedData,
      products: [{ ...first!, name: 'Edited in the seed file' }, ...rest, newProduct],
    };
    await seed(database.db, changed);
    const rows = await queryRows<{ id: string; name: string }>(
      database.db,
      sql`select id, name from products order by name`,
    );
    expect(rows).toHaveLength(seedData.products.length);
    expect(rows.find((r) => r.id === first!.id)!.name).toBe('Renamed');
    expect(rows.map((r) => r.id)).not.toContain(newProduct.id);
  });

  it('#63-7: a store with only a product added in the app is not seeded either', async () => {
    await seed(database.db, { ...seedData, products: [], recipes: [] });
    await database.db.execute(
      sql`insert into products (id, ingredient_class_id, name, source)
          values (gen_random_uuid(), 'curd', 'Added in the app', 'manual')`,
    );
    await seed(database.db);
    const rows = await queryRows(database.db, sql`select name from products`);
    expect(rows).toEqual([{ name: 'Added in the app' }]);
  });

  it('#63-7: recipes, classes and users are still seeded when the store holds products', async () => {
    await seed(database.db, { ...seedData, recipes: [] });
    expect(await queryRows(database.db, sql`select id from recipes`)).toEqual([]);
    const result = await seed(database.db);
    expect(await queryRows(database.db, sql`select id from recipes`)).toHaveLength(
      seedData.recipes.length,
    );
    expect(result.missingDefaultProducts).toEqual([]);
  });

  it('#63-7: a recipe step whose default product is not in the store loses only the default', async () => {
    await seed(database.db, { ...seedData, recipes: [] });
    const [recipe, ...otherRecipes] = seedData.recipes;
    const [first, ...rest] = recipe!.steps;
    const missing = 'a1b2c3d4-0000-4000-8000-0000000000bb';
    const changed = {
      ...seedData,
      recipes: [
        { ...recipe!, steps: [{ ...first!, defaultProductId: missing }, ...rest] },
        ...otherRecipes,
      ],
    };
    const result = await seed(database.db, changed);
    expect(result.missingDefaultProducts).toEqual([missing]);
    const steps = await queryRows(
      database.db,
      sql`select default_product_id from recipe_steps where id = ${first!.id}`,
    );
    expect(steps).toEqual([{ default_product_id: null }]);
    // Everything else of the seed went in, users included.
    expect(await queryRows(database.db, sql`select id from recipes`)).toHaveLength(
      seedData.recipes.length,
    );
    expect(await queryRows(database.db, sql`select id from users`)).toHaveLength(
      seedData.users.length,
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
    // Targets follow the seed file, whatever the user set there; an unset one stays null.
    const [user] = seedData.users;
    const targets = await queryRows(database.db, sql`select * from daily_targets`);
    expect(targets).toEqual([{ owner_id: user!.user.id, ...user!.targets }]);
  });

  it('stores an unset target as null, never 0', async () => {
    const [user] = seedData.users;
    const targets = { protein: 150, fat: null, carbs: null, fibre: null, kcal: null };
    await seed(database.db, { ...seedData, users: [{ ...user!, targets }] });
    const rows = await queryRows(database.db, sql`select * from daily_targets`);
    expect(rows).toEqual([{ owner_id: user!.user.id, ...targets }]);
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
