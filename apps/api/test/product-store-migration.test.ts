import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { queryRows, type Database } from '../src/db/client';
import { createTestDatabase, migrationsDir } from './support/db';

/** A copy of the real migrations without the ones after `lastTag`. */
function migrationsUpTo(lastTag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'macrofill-migrations-'));
  cpSync(migrationsDir, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  const last = journal.entries.findIndex((e) => e.tag === lastTag);
  if (last < 0) throw new Error(`No migration ${lastTag}.`);
  journal.entries = journal.entries.slice(0, last + 1);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

const user = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const seedProduct = '1de22574-2eab-46f7-bd0f-4910acdb36c2';
const ownProduct = '2ef33685-3fbc-47a8-ae10-5a21bdec47d3';
const recipe = '3f044796-40cd-48b9-bf21-6b32cefd58e4';
const step = '40155807-51de-49ca-8032-7c43dffe69f5';
const meal = '51266918-62ef-4adb-8143-8d54e00f7a06';

describe('#63-6: the shared product store migration keeps existing data', () => {
  let database: Database;
  const tempDirs: string[] = [];

  afterEach(async () => {
    await database.close();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const nutritionOf = () =>
    queryRows(
      database.db,
      sql`select id, ingredient_class_id, name, brand, kcal, fat, saturates, carbs, sugars, protein, salt, fibre
          from products order by id`,
    );

  it('#63-6: seed products keep their ids, nutrition and meals; a user product keeps its author', async () => {
    database = await createTestDatabase();
    const before = migrationsUpTo('0003_usage_events');
    tempDirs.push(before);
    await database.migrate(before);
    const { db } = database;
    // The schema as the last release left it: products have an owner.
    await db.execute(sql`insert into users (id, username, timezone) values (${user}, 'a', 'UTC')`);
    await db.execute(
      sql`insert into ingredient_classes (id, name) values ('curd', '{"en":"Curd"}'::jsonb)`,
    );
    await db.execute(
      sql`insert into products (id, owner_id, ingredient_class_id, name, brand, source, kcal, protein)
          values (${seedProduct}, null, 'curd', 'Seed curd', 'Brand', 'seed', 100, 12),
                 (${ownProduct}, ${user}, 'curd', 'Own curd', null, 'user', 90, null)`,
    );
    await db.execute(
      sql`insert into recipes (id, name) values (${recipe}, '{"en":"Curd"}'::jsonb)`,
    );
    await db.execute(
      sql`insert into recipe_steps (id, recipe_id, position, ingredient_class_id, default_product_id)
          values (${step}, ${recipe}, 0, 'curd', ${seedProduct})`,
    );
    await db.execute(
      sql`insert into prepared_meals (id, owner_id, recipe_id, input_method, started_at, finished_at)
          values (${meal}, ${user}, ${recipe}, 'direct', now(), now())`,
    );
    await db.execute(
      sql`insert into prepared_meal_items (owner_id, prepared_meal_id, position, step_id, skipped, product_id, grams, weight_source)
          values (${user}, ${meal}, 0, ${step}, false, ${seedProduct}, 200, 'manual'),
                 (${user}, ${meal}, 1, null, false, ${ownProduct}, 50, 'manual')`,
    );
    const nutritionBefore = await nutritionOf();

    await database.migrate(migrationsDir);

    expect(await nutritionOf()).toEqual(nutritionBefore);
    expect(
      await queryRows(
        db,
        sql`select id, source, created_by, barcode, source_ref from products order by id`,
      ),
    ).toEqual([
      { id: seedProduct, source: 'seed', created_by: null, barcode: null, source_ref: null },
      { id: ownProduct, source: 'manual', created_by: user, barcode: null, source_ref: null },
    ]);
    expect(
      await queryRows(db, sql`select product_id, grams from prepared_meal_items order by position`),
    ).toEqual([
      { product_id: seedProduct, grams: 200 },
      { product_id: ownProduct, grams: 50 },
    ]);
    expect(await queryRows(db, sql`select default_product_id from recipe_steps`)).toEqual([
      { default_product_id: seedProduct },
    ]);
    expect(
      await queryRows(
        db,
        sql`select column_name from information_schema.columns
            where table_name = 'products' and column_name = 'owner_id'`,
      ),
    ).toEqual([]);
  });
});
