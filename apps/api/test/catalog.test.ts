import { catalogSchema, type Catalog } from '@macrofill/domain';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { Database } from '../src/db/client';
import { seedData } from '../src/seed/data';
import { seed } from '../src/seed/seed';
import { createMigratedTestDatabase } from './support/db';

const otherUserId = '6c1f0e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b';
const curd = seedData.products.find((p) => p.ingredientClassId === 'curd')!;
const milk = seedData.products.find((p) => p.ingredientClassId === 'milk')!;

describe('GET /api/catalog (M5-1, M5-2)', () => {
  let database: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    database = await createMigratedTestDatabase();
    await seed(database.db);
    app = createApp({ db: database.db });
  });

  afterEach(async () => {
    await database.close();
  });

  const catalog = async (): Promise<Catalog> => {
    const res = await app.request('/api/catalog');
    expect(res.status).toBe(200);
    return catalogSchema.parse(await res.json());
  };

  const saveMeal = (id: string, finishedAt: string, items: unknown[]) =>
    app.request('/api/meals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meal: { id, inputMethod: 'direct', startedAt: finishedAt, finishedAt, items },
        consumptionEntry: {
          id: crypto.randomUUID(),
          eatenAt: finishedAt,
          portion: { type: 'whole' },
        },
      }),
    });

  it('lists the seeded classes, recipes with ordered steps, and products', async () => {
    const body = await catalog();
    expect(body.ingredientClasses).toEqual(expect.arrayContaining(seedData.ingredientClasses));
    expect(body.recipes).toEqual(expect.arrayContaining(seedData.recipes));
    expect(body.recipes).toHaveLength(seedData.recipes.length);
    expect(body.products).toHaveLength(seedData.products.length);
    expect(body.products.find((p) => p.id === curd.id)).toEqual({ ...curd, lastUsedAt: null });
  });

  it("M5-2: a product's lastUsedAt is the finish time of the user's latest meal with it", async () => {
    const weighed = (productId: string) => ({
      skipped: false,
      productId,
      grams: 100,
      weightSource: 'manual',
    });
    await saveMeal(crypto.randomUUID(), '2026-01-10T08:00:00.000Z', [weighed(curd.id)]);
    await saveMeal(crypto.randomUUID(), '2026-01-12T08:00:00.000Z', [
      weighed(curd.id),
      { skipped: true },
    ]);
    await saveMeal(crypto.randomUUID(), '2026-01-11T08:00:00.000Z', [weighed(milk.id)]);
    const products = new Map((await catalog()).products.map((p) => [p.id, p.lastUsedAt]));
    expect(products.get(curd.id)).toBe('2026-01-12T08:00:00.000Z');
    expect(products.get(milk.id)).toBe('2026-01-11T08:00:00.000Z');
    expect([...products.values()].filter((v) => v !== null)).toHaveLength(2);
  });

  it('M5-2: skipped items never count as a use, even if one carried a product', async () => {
    // The CHECK constraint already stops a skipped item from carrying a product. It's dropped
    // here on purpose, to test that the query itself ignores skipped items.
    await saveMeal(crypto.randomUUID(), '2026-01-12T08:00:00.000Z', [
      { skipped: false, productId: curd.id, grams: 100, weightSource: 'manual' },
    ]);
    await database.db.execute(
      sql`alter table prepared_meal_items drop constraint prepared_meal_items_skipped_shape`,
    );
    const mealId = crypto.randomUUID();
    const owner = seedData.users[0]!.user.id;
    await database.db.execute(
      sql`insert into prepared_meals (id, owner_id, input_method, started_at, finished_at)
          values (${mealId}, ${owner}, 'direct', '2026-01-20T08:00:00Z', '2026-01-20T08:00:00Z')`,
    );
    await database.db.execute(
      sql`insert into prepared_meal_items (owner_id, prepared_meal_id, position, skipped, product_id)
          values (${owner}, ${mealId}, 0, true, ${curd.id})`,
    );
    const products = new Map((await catalog()).products.map((p) => [p.id, p.lastUsedAt]));
    expect(products.get(curd.id)).toBe('2026-01-12T08:00:00.000Z');
  });

  it("includes the user's own products, with their own lastUsedAt", async () => {
    const ownProductId = 'f2c8a6b7-0d1e-4f2a-9b3c-3d2e1f0a9b8c';
    await database.db.execute(
      sql`insert into products (id, owner_id, ingredient_class_id, name, source, protein)
          values (${ownProductId}, ${seedData.users[0]!.user.id}, 'curd', 'Homemade curd', 'user', 12)`,
    );
    await saveMeal(crypto.randomUUID(), '2026-01-13T08:00:00.000Z', [
      { skipped: false, productId: ownProductId, grams: 50, weightSource: 'manual' },
    ]);
    const own = (await catalog()).products.find((p) => p.id === ownProductId);
    expect(own).toMatchObject({
      name: 'Homemade curd',
      source: 'user',
      ingredientClassId: 'curd',
      lastUsedAt: '2026-01-13T08:00:00.000Z',
    });
    expect(own?.nutrition.protein).toBe(12);
    expect(own?.nutrition.fat).toBeNull();
  });

  it("ignores other users' history and hides their own products", async () => {
    await database.db.execute(
      sql`insert into users (id, username, timezone) values (${otherUserId}, 'other', 'UTC')`,
    );
    await database.db.execute(
      sql`insert into products (id, owner_id, ingredient_class_id, name, source)
          values ('e0b6f4d5-7a8c-4b9d-8e1f-0a9b8c7d6e5f', ${otherUserId}, 'curd', 'private', 'user')`,
    );
    const mealId = crypto.randomUUID();
    await database.db.execute(
      sql`insert into prepared_meals (id, owner_id, input_method, started_at, finished_at)
          values (${mealId}, ${otherUserId}, 'direct', now(), now())`,
    );
    await database.db.execute(
      sql`insert into prepared_meal_items (owner_id, prepared_meal_id, position, skipped, product_id, grams, weight_source)
          values (${otherUserId}, ${mealId}, 0, false, ${curd.id}, 100, 'manual')`,
    );
    const body = await catalog();
    expect(body.products).toHaveLength(seedData.products.length);
    expect(body.products.every((p) => p.lastUsedAt === null)).toBe(true);
  });
});
