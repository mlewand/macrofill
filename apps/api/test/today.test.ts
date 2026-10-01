import { todaySchema, type Today } from '@macrofill/domain';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { queryRows, type Database } from '../src/db/client';
import { seedData } from '../src/seed/data';
import { seed } from '../src/seed/seed';
import { createMigratedTestDatabase } from './support/db';
import { signedIn, type TestApp } from './support/session';

const curdRecipe = seedData.recipes.find((r) => r.name.en === 'Curd')!;
const curd = seedData.products.find((p) => p.ingredientClassId === 'curd')!;
const milk = seedData.products.find((p) => p.ingredientClassId === 'milk')!;
const otherUserId = '6c1f0e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b';

// Noon in Warsaw on 15 January 2026 (UTC+1).
const NOW = new Date('2026-01-15T11:00:00.000Z');

describe('Today (M7-1 to M7-4)', () => {
  let database: Database;
  let app: TestApp;

  beforeEach(async () => {
    database = await createMigratedTestDatabase();
    await seed(database.db);
    app = await signedIn(createApp({ db: database.db, now: () => NOW }), database.db);
  });

  afterEach(async () => {
    await database.close();
  });

  const save = async (eatenAt: string, items: unknown[], recipeId?: string) => {
    const mealId = crypto.randomUUID();
    const entryId = crypto.randomUUID();
    const res = await app.request('/api/meals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meal: {
          id: mealId,
          ...(recipeId ? { recipeId } : {}),
          inputMethod: 'direct',
          startedAt: eatenAt,
          finishedAt: eatenAt,
          items,
        },
        consumptionEntry: { id: entryId, eatenAt, portion: { type: 'whole' } },
      }),
    });
    expect(res.status).toBe(201);
    return { mealId, entryId };
  };
  const weighed = (productId: string, grams: number) => ({
    skipped: false,
    productId,
    grams,
    weightSource: 'manual',
  });

  const today = async (): Promise<Today> => {
    const res = await app.request('/api/today');
    expect(res.status).toBe(200);
    return todaySchema.parse(await res.json());
  };

  it("returns the day in the user's timezone with the seeded targets", async () => {
    const body = await today();
    expect(body).toMatchObject({
      timezone: 'Europe/Warsaw',
      day: '2026-01-15',
      targets: seedData.users[0]!.targets,
      entries: [],
    });
    expect(body.totals).toMatchObject({ protein: 0, kcal: 0, fibre: 0 });
  });

  it("M7-1: lists the day's entries in the user's timezone, newest first, with recipe name, time and macros", async () => {
    const morning = await save('2026-01-15T06:30:00.000Z', [weighed(curd.id, 200)], curdRecipe.id);
    // 23:30 in Warsaw on the 15th is 22:30 UTC: it counts toward the 15th (M2-5).
    const lateNight = await save('2026-01-15T22:30:00.000Z', [weighed(milk.id, 100)]);
    // 00:30 in Warsaw on the 16th, and 23:30 in Warsaw on the 14th: other days.
    await save('2026-01-15T23:30:00.000Z', [weighed(milk.id, 100)]);
    await save('2026-01-14T22:30:00.000Z', [weighed(milk.id, 100)]);

    const body = await today();
    expect(body.entries.map((e) => e.id)).toEqual([lateNight.entryId, morning.entryId]);
    expect(body.entries[1]).toMatchObject({
      preparedMealId: morning.mealId,
      eatenAt: '2026-01-15T06:30:00.000Z',
      recipeName: { en: 'Curd' },
    });
    expect(body.entries[0]!.recipeName).toBeNull();
    expect(body.entries[1]!.nutrition.protein).toBeCloseTo(34, 10);
  });

  it('M7-2, M7-3: totals are the sum of the entries, and unknown fibre stays unknown', async () => {
    await save('2026-01-15T06:30:00.000Z', [weighed(curd.id, 200)]);
    await save('2026-01-15T10:00:00.000Z', [weighed(milk.id, 250), { skipped: true }]);
    const { totals } = await today();
    expect(totals.protein).toBeCloseTo(200 * 0.17 + 250 * 0.03, 10);
    expect(totals.kcal).toBeCloseTo(200 * 1.19 + 250 * 0.6, 10);
    expect(totals.fibre).toBeNull();
  });

  it("never includes other users' entries", async () => {
    await database.db.execute(
      sql`insert into users (id, username, timezone) values (${otherUserId}, 'other', 'Europe/Warsaw')`,
    );
    const mealId = crypto.randomUUID();
    await database.db.execute(
      sql`insert into prepared_meals (id, owner_id, input_method, started_at, finished_at)
          values (${mealId}, ${otherUserId}, 'direct', '2026-01-15T08:00:00Z', '2026-01-15T08:00:00Z')`,
    );
    await database.db.execute(
      sql`insert into consumption_entries (id, owner_id, prepared_meal_id, eaten_at, portion)
          values (${crypto.randomUUID()}, ${otherUserId}, ${mealId}, '2026-01-15T08:00:00Z', '{"type":"whole"}')`,
    );
    expect((await today()).entries).toEqual([]);
  });

  describe('M7-4: deleting a consumption entry', () => {
    const remove = (id: string) =>
      app.request(`/api/consumption-entries/${id}`, { method: 'DELETE' });

    it('removes it from the day', async () => {
      const kept = await save('2026-01-15T06:30:00.000Z', [weighed(curd.id, 200)]);
      const removed = await save('2026-01-15T08:30:00.000Z', [weighed(milk.id, 100)]);
      expect((await remove(removed.entryId)).status).toBe(204);
      const body = await today();
      expect(body.entries.map((e) => e.id)).toEqual([kept.entryId]);
      expect(body.totals.protein).toBeCloseTo(34, 10);
    });

    it('a second delete, or an unknown id, is 404', async () => {
      const { entryId } = await save('2026-01-15T06:30:00.000Z', [weighed(curd.id, 200)]);
      await remove(entryId);
      expect((await remove(entryId)).status).toBe(404);
      expect((await remove(crypto.randomUUID())).status).toBe(404);
    });

    it("another user's entry is 404, and stays", async () => {
      await database.db.execute(
        sql`insert into users (id, username, timezone) values (${otherUserId}, 'other', 'UTC')`,
      );
      const mealId = crypto.randomUUID();
      const entryId = crypto.randomUUID();
      await database.db.execute(
        sql`insert into prepared_meals (id, owner_id, input_method, started_at, finished_at)
            values (${mealId}, ${otherUserId}, 'direct', now(), now())`,
      );
      await database.db.execute(
        sql`insert into consumption_entries (id, owner_id, prepared_meal_id, eaten_at, portion)
            values (${entryId}, ${otherUserId}, ${mealId}, now(), '{"type":"whole"}')`,
      );
      expect((await remove(entryId)).status).toBe(404);
      const rows = await queryRows(database.db, sql`select id from consumption_entries`);
      expect(rows).toEqual([{ id: entryId }]);
    });

    it('an id that is not a UUID is 400', async () => {
      const res = await remove('not-a-uuid');
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: 'invalid_request',
        issues: [{ path: 'id' }],
      });
    });

    it('keeps the prepared meal; a late retry of its save is 410 and does not bring the entry back', async () => {
      const body = {
        meal: {
          id: crypto.randomUUID(),
          inputMethod: 'direct',
          startedAt: '2026-01-15T06:30:00.000Z',
          finishedAt: '2026-01-15T06:30:00.000Z',
          items: [weighed(curd.id, 200)],
        },
        consumptionEntry: {
          id: crypto.randomUUID(),
          eatenAt: '2026-01-15T06:30:00.000Z',
          portion: { type: 'whole' },
        },
      };
      const post = () =>
        app.request('/api/meals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      expect((await post()).status).toBe(201);
      expect((await remove(body.consumptionEntry.id)).status).toBe(204);

      const retry = await post();
      expect(retry.status).toBe(410);
      expect(await retry.json()).toEqual({ error: 'deleted' });
      expect((await today()).entries).toEqual([]);
      const meals = await queryRows(database.db, sql`select id from prepared_meals`);
      expect(meals).toEqual([{ id: body.meal.id }]);
    });
  });
});
