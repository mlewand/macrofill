import { catalogSchema, todaySchema, type SaveMealRequest } from '@macrofill/domain';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { queryRows, type Database, type Db } from '../src/db/client';
import { seedData } from '../src/seed/data';
import { seed } from '../src/seed/seed';
import { createMigratedTestDatabase } from './support/db';
import { signedIn, type TestApp } from './support/session';

// M4-3: user B never sees or changes user A's data, through any route. Every route in the table
// registers a fixture below, which makes resources owned by A and checks what B gets. A route
// without one fails the test, so a new route can't skip the check.

const userA = seedData.users[0]!.user;
const userB = { id: '6c1f0e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b', username: 'other' };
const curdRecipe = seedData.recipes.find((r) => r.name.en === 'Curd')!;
const curd = seedData.products.find((p) => p.ingredientClassId === 'curd')!;
/** A product only A can see. */
const privateProductId = 'e0b6f4d5-7a8c-4b9d-8e1f-0a9b8c7d6e5f';
const NOW = new Date('2026-01-15T11:00:00.000Z');

/** A's meal: A's private product and a seed product, eaten today. */
const mealOfA: SaveMealRequest = {
  meal: {
    id: 'b7e3c1a2-4d5f-4e6a-9b8c-7d6e5f4a3b2c',
    recipeId: curdRecipe.id,
    inputMethod: 'direct',
    startedAt: '2026-01-15T07:00:00.000Z',
    finishedAt: '2026-01-15T07:05:00.000Z',
    items: [
      {
        stepId: curdRecipe.steps[0]!.id,
        skipped: false,
        productId: curd.id,
        grams: 200,
        weightSource: 'manual',
      },
      {
        stepId: curdRecipe.steps[1]!.id,
        skipped: false,
        productId: privateProductId,
        grams: 50,
        weightSource: 'manual',
      },
    ],
  },
  consumptionEntry: {
    id: 'c8f4d2b3-5e6a-4f7b-8c9d-8e7f6a5b4c3d',
    eatenAt: '2026-01-15T07:05:00.000Z',
    portion: { type: 'whole' },
  },
};

interface Context {
  a: TestApp;
  b: TestApp;
  db: Db;
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const count = async (db: Db, table: string) => {
  const [row] = await queryRows<{ n: number }>(
    db,
    sql`select count(*)::int as n from ${sql.identifier(table)}`,
  );
  return row!.n;
};

/** Per route (`METHOD path` as in `app.routes`): what B gets for A's resources. */
const fixtures: Record<string, (ctx: Context) => Promise<void>> = {
  'GET /api/catalog': async ({ a, b }) => {
    const ofB = catalogSchema.parse(await (await b.request('/api/catalog')).json());
    expect(ofB.products.map((p) => p.id)).not.toContain(privateProductId);
    // A's use of a seed product doesn't show as B's history (M5-2).
    expect(ofB.products.find((p) => p.id === curd.id)!.lastUsedAt).toBeNull();
    const ofA = catalogSchema.parse(await (await a.request('/api/catalog')).json());
    expect(ofA.products.map((p) => p.id)).toContain(privateProductId);
  },

  'GET /api/today': async ({ a, b }) => {
    const ofB = todaySchema.parse(await (await b.request('/api/today')).json());
    expect(ofB.entries).toEqual([]);
    expect(ofB.totals.kcal).toBe(0);
    const ofA = todaySchema.parse(await (await a.request('/api/today')).json());
    expect(ofA.entries.map((e) => e.id)).toEqual([mealOfA.consumptionEntry.id]);
  },

  'DELETE /api/consumption-entries/:id': async ({ a, b }) => {
    const res = await b.request(`/api/consumption-entries/${mealOfA.consumptionEntry.id}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
    const ofA = todaySchema.parse(await (await a.request('/api/today')).json());
    expect(ofA.entries).toHaveLength(1);
  },

  'POST /api/meals': async ({ b, db }) => {
    const meals = await count(db, 'prepared_meals');
    // A's meal ids, with only a seed product: never a success, never A's data back (M4-6
    // answers 409). With A's private product it's refused before that, as unknown (400).
    expect((await b.request('/api/meals', json(mealOfA))).status).toBe(400);
    const retry = await b.request(
      '/api/meals',
      json({ ...mealOfA, meal: { ...mealOfA.meal, items: mealOfA.meal.items.slice(0, 1) } }),
    );
    expect(retry.status).toBe(409);
    expect(await retry.json()).toEqual({ error: 'conflict' });
    // A new meal of B's with A's private product: as if it didn't exist.
    const own = await b.request(
      '/api/meals',
      json({
        meal: { ...mealOfA.meal, id: '0d5c2b8e-6f4a-4c3b-9a1d-2e3f4a5b6c7d' },
        consumptionEntry: {
          ...mealOfA.consumptionEntry,
          id: '1e6d3c9f-7a5b-4d4c-8b2e-3f4a5b6c7d8e',
        },
      }),
    );
    expect(own.status).toBe(400);
    expect(await count(db, 'prepared_meals')).toBe(meals);
  },
};

/** Routes with nothing owned by a user, and why. */
const exempt: Record<string, string> = {
  'GET /api/health': 'checks the database; no user data, and no session (M4-2)',
  'POST /api/login': 'opens a session for whoever has the password; no user data',
};

describe('M4-3: ownership over the full route table', () => {
  let database: Database;
  let ctx: Context;

  beforeEach(async () => {
    database = await createMigratedTestDatabase();
    const db = database.db;
    await seed(db);
    await db.execute(
      sql`insert into users (id, username, timezone) values (${userB.id}, ${userB.username}, 'Europe/Warsaw')`,
    );
    await db.execute(
      sql`insert into products (id, owner_id, ingredient_class_id, name, source)
          values (${privateProductId}, ${userA.id}, 'milk', 'A''s milk', 'user')`,
    );
    const app = createApp({ db, now: () => NOW });
    const a = await signedIn(app, db, userA.username);
    const b = await signedIn(app, db, userB.username);
    expect((await a.request('/api/meals', json(mealOfA))).status).toBe(201);
    ctx = { a, b, db };
  });

  afterEach(async () => {
    await database.close();
  });

  const routes = createApp({ db: {} as Db })
    .routes.filter((r) => r.method !== 'ALL' && r.path.startsWith('/api/'))
    .map((r) => `${r.method} ${r.path}`);

  it('M4-3: every route has an ownership fixture or a stated exemption', () => {
    expect(routes.length).toBeGreaterThan(Object.keys(exempt).length);
    const missing = routes.filter((route) => !(route in fixtures) && !(route in exempt));
    expect(missing, 'routes without an ownership fixture').toEqual([]);
    // And no fixture for a route that's gone.
    expect(Object.keys(fixtures).filter((route) => !routes.includes(route))).toEqual([]);
  });

  it.each(Object.keys(fixtures))('M4-3: %s keeps user A’s data from user B', async (route) => {
    await fixtures[route]!(ctx);
  });
});
