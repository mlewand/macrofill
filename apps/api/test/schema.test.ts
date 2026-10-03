import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryRows, type Database } from '../src/db/client';
import { seedData } from '../src/seed/data';
import { seed } from '../src/seed/seed';
import { createMigratedTestDatabase } from './support/db';

const meal = '5a0b6c1e-2f3d-4e5a-8b7c-9d0e1f2a3b4c';

describe('M2-2: the database enforces the prepared meal item shape', () => {
  let database: Database;
  const owner = seedData.users[0]!.user.id;
  const product = seedData.products[0]!.id;

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    await seed(database.db);
    await database.db.execute(
      sql`insert into prepared_meals (id, owner_id, input_method, started_at, finished_at)
          values (${meal}, ${owner}, 'direct', now(), now())`,
    );
  });

  afterAll(async () => {
    await database.close();
  });

  let position = 0;
  const insertItem = (item: {
    skipped: boolean;
    productId: string | null;
    grams: number | null;
    weightSource: string | null;
  }) =>
    database.db.execute(
      sql`insert into prepared_meal_items
            (owner_id, prepared_meal_id, position, skipped, product_id, grams, weight_source)
          values (${owner}, ${meal}, ${position++}, ${item.skipped}, ${item.productId},
                  ${item.grams}, ${item.weightSource})`,
    );

  it('accepts a weighed item and a skipped item', async () => {
    await insertItem({ skipped: false, productId: product, grams: 0, weightSource: 'scale' });
    await insertItem({ skipped: true, productId: null, grams: null, weightSource: null });
  });

  it.each([
    [
      'a weighed item without grams (regression: #10)',
      { skipped: false, productId: product, grams: null, weightSource: 'manual' },
    ],
    [
      'a weighed item without a product',
      { skipped: false, productId: null, grams: 10, weightSource: 'manual' },
    ],
    [
      'a weighed item without a weight source',
      { skipped: false, productId: product, grams: 10, weightSource: null },
    ],
    ['negative grams', { skipped: false, productId: product, grams: -1, weightSource: 'manual' }],
    [
      'a skipped item with grams',
      { skipped: true, productId: null, grams: 10, weightSource: null },
    ],
    [
      'a skipped item with a product',
      { skipped: true, productId: product, grams: null, weightSource: null },
    ],
    [
      'an unknown weight source (regression: #10)',
      { skipped: false, productId: product, grams: 10, weightSource: 'guess' },
    ],
  ])('rejects %s', async (_case, item) => {
    await expect(insertItem(item)).rejects.toThrow();
  });
});

describe('the database enforces enum values', () => {
  let database: Database;
  const owner = seedData.users[0]!.user.id;

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    await seed(database.db);
  });

  afterAll(async () => {
    await database.close();
  });

  it('rejects an unknown meal input method (regression: #10)', async () => {
    await expect(
      database.db.execute(
        sql`insert into prepared_meals (id, owner_id, input_method, started_at, finished_at)
            values (gen_random_uuid(), ${owner}, 'guess', now(), now())`,
      ),
    ).rejects.toThrow();
  });

  it('rejects an unknown product source (regression: #10)', async () => {
    await expect(
      database.db.execute(
        sql`insert into products (id, ingredient_class_id, name, source)
            values (gen_random_uuid(), 'curd', 'x', 'guess')`,
      ),
    ).rejects.toThrow();
  });
});

describe('#63-2, #63-3: the database enforces the shared product shape', () => {
  let database: Database;
  const author = seedData.users[0]!.user.id;
  const insert = (columns: string, values: string) =>
    database.db.execute(
      sql.raw(
        `insert into products (id, ingredient_class_id, name, source${columns === '' ? '' : `, ${columns}`})
         values (gen_random_uuid(), 'curd', 'x', ${values})`,
      ),
    );

  /** Rejects because of the named constraint, not because the statement is malformed. */
  const violates = async (statement: Promise<unknown>, constraint: string) => {
    const error = await statement.then(
      () => undefined,
      (e: unknown) => e,
    );
    const text = (e: unknown): string =>
      e instanceof Error ? `${e.message} ${text(e.cause)}` : '';
    expect(text(error)).toContain(constraint);
  };

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    await seed(database.db);
  });

  afterAll(async () => {
    await database.close();
  });

  it('#63-2: a barcode is 13 digits and unique across the store; products may have none', async () => {
    await insert('barcode', `'manual', '5901234123457'`);
    await violates(insert('barcode', `'manual', '5901234123457'`), 'products_barcode_unique');
    for (const barcode of ['590123412345', '59012341234570', '590123412345a', '']) {
      await violates(insert('barcode', `'manual', '${barcode}'`), 'products_barcode_form');
    }
    await insert('', `'manual'`);
    await insert('', `'manual'`);
  });

  it('#63-3: a product records its source, the provider reference and who added it', async () => {
    await insert('source_ref, created_by', `'manual', 'ref-1', '${author}'`);
    await violates(insert('', `'user'`), 'products_source_values');
  });

  it('#63-4: deleting the user who added a product clears createdBy and keeps the product', async () => {
    const other = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
    const id = '8c7b6a59-4e3d-4c2b-9a19-0e9d8c7b6a59';
    await database.db.execute(
      sql`insert into users (id, username, timezone) values (${other}, 'leaving', 'UTC')`,
    );
    await database.db.execute(
      sql`insert into products (id, ingredient_class_id, name, source, created_by)
          values (${id}, 'curd', 'Kept', 'manual', ${other})`,
    );
    // The user owns data too, so the delete cascades through it at the same time.
    await database.db.execute(
      sql`insert into prepared_meals (id, owner_id, input_method, started_at, finished_at)
          values (gen_random_uuid(), ${other}, 'direct', now(), now())`,
    );
    await database.db.execute(sql`delete from users where id = ${other}`);
    const rows = await queryRows(
      database.db,
      sql`select name, created_by from products where id = ${id}`,
    );
    expect(rows).toEqual([{ name: 'Kept', created_by: null }]);
  });
});
