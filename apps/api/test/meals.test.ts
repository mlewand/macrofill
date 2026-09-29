import type { SaveMealRequest } from '@macrofill/domain';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { queryRows, type Database } from '../src/db/client';
import { seedData } from '../src/seed/data';
import { seed } from '../src/seed/seed';
import { createMigratedTestDatabase } from './support/db';

const owner = seedData.users[0]!.user;
const [curdRecipe] = seedData.recipes.filter((r) => r.name.en === 'Curd');
const curdProduct = seedData.products.find((p) => p.ingredientClassId === 'curd')!;
const otherUserId = '6c1f0e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b';

function request(overrides: Partial<SaveMealRequest['meal']> = {}): SaveMealRequest {
  return {
    meal: {
      id: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
      recipeId: curdRecipe!.id,
      inputMethod: 'direct',
      startedAt: '2026-01-15T07:00:00.000Z',
      finishedAt: '2026-01-15T07:05:00.000Z',
      items: [
        {
          stepId: curdRecipe!.steps[0]!.id,
          skipped: false,
          productId: curdProduct.id,
          grams: 212.5,
          weightSource: 'manual',
        },
        { stepId: curdRecipe!.steps[1]!.id, skipped: true },
      ],
      ...overrides,
    },
    consumptionEntry: {
      id: 'c8f4d2b3-5e6a-4f7b-8c9d-8e7f6a5b4c3d',
      eatenAt: '2026-01-15T07:05:00.000Z',
      portion: { type: 'whole' },
    },
  };
}

describe('POST /api/meals', () => {
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

  const post = (body: unknown) =>
    app.request('/api/meals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  const count = async (table: string) => {
    const [row] = await queryRows<{ n: number }>(
      database.db,
      sql`select count(*)::int as n from ${sql.identifier(table)}`,
    );
    return row!.n;
  };

  describe('M4-6: saving is idempotent through the client-generated id', () => {
    it('saves the meal and its consumption entry, owned by the current user', async () => {
      const body = request();
      const res = await post(body);
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({
        meal: body.meal,
        consumptionEntry: { ...body.consumptionEntry, preparedMealId: body.meal.id },
      });
      const owners = await queryRows<{ owner_id: string }>(
        database.db,
        sql`select owner_id from prepared_meals union all select owner_id from consumption_entries
            union all select owner_id from prepared_meal_items`,
      );
      expect(owners.map((o) => o.owner_id)).toEqual([owner.id, owner.id, owner.id, owner.id]);
    });

    it('posting the same meal twice creates exactly one meal and one consumption entry', async () => {
      const first = await post(request());
      const second = await post(request());
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(await second.json()).toEqual(await first.json());
      expect(await count('prepared_meals')).toBe(1);
      expect(await count('consumption_entries')).toBe(1);
      expect(await count('prepared_meal_items')).toBe(2);
    });

    it('concurrent retries still create exactly one meal and one entry', async () => {
      const statuses = await Promise.all([post(request()), post(request()), post(request())]);
      expect(statuses.map((r) => r.status).sort()).toEqual([200, 200, 201]);
      expect(await count('prepared_meals')).toBe(1);
      expect(await count('consumption_entries')).toBe(1);
    });

    it('a meal id owned by another user is a conflict, never a success', async () => {
      await database.db.execute(
        sql`insert into users (id, username, timezone) values (${otherUserId}, 'other', 'UTC')`,
      );
      await database.db.execute(
        sql`insert into prepared_meals (id, owner_id, input_method, started_at, finished_at)
            values (${request().meal.id}, ${otherUserId}, 'direct', now(), now())`,
      );
      const res = await post(request());
      expect(res.status).toBe(409);
      expect(await count('consumption_entries')).toBe(0);
      expect(await count('prepared_meal_items')).toBe(0);
    });

    it('a consumption entry id already in use is a conflict, and nothing is saved', async () => {
      await post(request());
      const res = await post({
        ...request(),
        meal: { ...request().meal, id: 'd9a5e3c4-6f7b-4a8c-9d0e-9f8a7b6c5d4e' },
      });
      expect(res.status).toBe(409);
      expect(await count('prepared_meals')).toBe(1);
    });
  });

  describe('M4-4: request bodies are validated with the shared zod schemas', () => {
    it('invalid input returns 400 with field-level errors', async () => {
      const body = request();
      const res = await post({
        ...body,
        meal: {
          ...body.meal,
          items: [{ ...body.meal.items[0], grams: -1 }],
          inputMethod: 'guess',
        },
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string; issues: { path: string }[] };
      expect(json.error).toBe('invalid_request');
      expect(json.issues.map((i) => i.path).sort()).toEqual([
        'meal.inputMethod',
        'meal.items.0.grams',
      ]);
      expect(await count('prepared_meals')).toBe(0);
    });

    it('a skipped item with grams is rejected', async () => {
      const body = request({ items: [{ skipped: true, grams: 10 } as never] });
      expect((await post(body)).status).toBe(400);
    });

    it('malformed JSON returns 400', async () => {
      const res = await post('{"meal":');
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid_json' });
    });

    it('an unknown product returns 400 on that item', async () => {
      const body = request();
      const item = { ...body.meal.items[0]!, productId: '00000000-0000-4000-8000-000000000000' };
      const res = await post({ ...body, meal: { ...body.meal, items: [item] } });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        issues: [{ path: 'meal.items.0.productId' }],
      });
    });

    it("another user's own product can't be used", async () => {
      const productId = 'e0b6f4d5-7a8c-4b9d-8e1f-0a9b8c7d6e5f';
      await database.db.execute(
        sql`insert into users (id, username, timezone) values (${otherUserId}, 'other', 'UTC')`,
      );
      await database.db.execute(
        sql`insert into products (id, owner_id, ingredient_class_id, name, source)
            values (${productId}, ${otherUserId}, 'curd', 'private', 'user')`,
      );
      const body = request();
      const item = { ...body.meal.items[0]!, productId };
      const res = await post({ ...body, meal: { ...body.meal, items: [item] } });
      expect(res.status).toBe(400);
      expect(await count('prepared_meals')).toBe(0);
    });

    it('an unknown recipe returns 400', async () => {
      const res = await post(request({ recipeId: '00000000-0000-4000-8000-000000000000' }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ issues: [{ path: 'meal.recipeId' }] });
    });

    it('every route that takes a body rejects an invalid one with 400', async () => {
      const routes = app.routes.filter((r) => ['POST', 'PUT', 'PATCH'].includes(r.method));
      expect(routes.length).toBeGreaterThan(0);
      for (const route of routes) {
        for (const body of ['{}', '{"x":', '[]']) {
          const res = await app.request(route.path, {
            method: route.method,
            headers: { 'Content-Type': 'application/json' },
            body,
          });
          expect(res.status, `${route.method} ${route.path} ${body}`).toBe(400);
        }
      }
    });
  });
});

describe('Phase A stub auth', () => {
  let database: Database;

  afterEach(async () => {
    await database.close();
  });

  it('acts as the seeded user; without that user, api routes return 401', async () => {
    database = await createMigratedTestDatabase();
    const app = createApp({ db: database.db });
    const res = await app.request('/api/meals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request()),
    });
    expect(res.status).toBe(401);
    // Health stays outside auth (M4-2 exempts it later).
    expect((await app.request('/api/health')).status).toBe(200);
  });
});
