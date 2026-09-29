import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/db/client';
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
      'a weighed item without grams',
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
      'an unknown weight source',
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

  it('rejects an unknown meal input method', async () => {
    await expect(
      database.db.execute(
        sql`insert into prepared_meals (id, owner_id, input_method, started_at, finished_at)
            values (gen_random_uuid(), ${owner}, 'guess', now(), now())`,
      ),
    ).rejects.toThrow();
  });

  it('rejects an unknown product source', async () => {
    await expect(
      database.db.execute(
        sql`insert into products (id, owner_id, ingredient_class_id, name, source)
            values (gen_random_uuid(), ${owner}, 'curd', 'x', 'guess')`,
      ),
    ).rejects.toThrow();
  });
});
