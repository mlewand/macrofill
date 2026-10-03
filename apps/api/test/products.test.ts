import { catalogProductSchema, catalogSchema, type CreateProductRequest } from '@macrofill/domain';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { queryRows, type Database } from '../src/db/client';
import { seedData } from '../src/seed/data';
import { seed } from '../src/seed/seed';
import { createMigratedTestDatabase } from './support/db';
import { signedIn, type TestApp } from './support/session';

const userB = { id: '6c1f0e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b', username: 'other' };

const request: CreateProductRequest = {
  id: '4f0c7a3e-3b8e-4d7a-9a51-6c1f2d9e8b01',
  ingredientClassId: 'curd',
  name: 'Homemade curd',
  brand: 'Home',
  nutrition: {
    kcal: 119,
    fat: 4.2,
    saturates: null,
    carbs: 3.4,
    sugars: null,
    protein: 17,
    salt: null,
    fibre: null,
  },
};

describe('POST /api/products (#64-1, #64-4, #64-8)', () => {
  let database: Database;
  let app: TestApp;
  let appB: TestApp;

  beforeEach(async () => {
    database = await createMigratedTestDatabase();
    await seed(database.db);
    await database.db.execute(
      sql`insert into users (id, username, timezone) values (${userB.id}, ${userB.username}, 'UTC')`,
    );
    const base = createApp({ db: database.db });
    app = await signedIn(base, database.db);
    appB = await signedIn(base, database.db, userB.username);
  });

  afterEach(async () => {
    await database.close();
  });

  const post = (client: TestApp, body: unknown) =>
    client.request('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const rows = () =>
    queryRows<{ id: string; source: string; created_by: string | null; fibre: number | null }>(
      database.db,
      sql`select id, source, created_by, fibre from products where id = ${request.id}`,
    );

  it('#64-4: creates the product as manual, answers 201 with it, and records who added it', async () => {
    const res = await post(app, request);
    expect(res.status).toBe(201);
    const body = catalogProductSchema.parse(await res.json());
    expect(body).toEqual({ ...request, source: 'manual', lastUsedAt: null });
    expect(await rows()).toEqual([
      { id: request.id, source: 'manual', created_by: seedData.users[0]!.user.id, fibre: null },
    ]);
  });

  it('#64-1: an empty value is stored as unknown, never 0 (M2-3)', async () => {
    const res = await post(app, { ...request, brand: undefined });
    expect(res.status).toBe(201);
    const body = catalogProductSchema.parse(await res.json());
    expect(body.nutrition.fibre).toBeNull();
    expect(body.brand).toBeUndefined();
    expect((await rows())[0]!.fibre).toBeNull();
  });

  it('#63-4, #64-4: no response shows who added it, not even as a key', async () => {
    const created = await (await post(app, request)).text();
    expect(created).not.toMatch(/created_?by|owner/i);
    const again = await (await post(app, request)).text();
    expect(again).not.toMatch(/created_?by|owner/i);
  });

  it('#64-4: a product one user adds is in every user’s catalog, without a reload of the app', async () => {
    await post(app, request);
    for (const client of [app, appB]) {
      const catalog = catalogSchema.parse(await (await client.request('/api/catalog')).json());
      const added = catalog.products.find((p) => p.id === request.id);
      expect(added).toMatchObject({ name: 'Homemade curd', source: 'manual', lastUsedAt: null });
    }
  });

  it('#64-8: a retry of the same request answers 200 with the stored product and adds nothing', async () => {
    const first = await post(app, request);
    expect(first.status).toBe(201);
    const retry = await post(app, request);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(await first.json());
    expect(await rows()).toHaveLength(1);
  });

  it('#64-8: a retry with no brand matches a product stored without one', async () => {
    const { brand: _brand, ...noBrand } = request;
    expect((await post(app, noBrand)).status).toBe(201);
    expect((await post(app, noBrand)).status).toBe(200);
  });

  it('#64-8: the same id with other content is a conflict, and the stored product stays', async () => {
    await post(app, request);
    const other = await post(app, { ...request, name: 'Something else' });
    expect(other.status).toBe(409);
    expect(await other.json()).toEqual({ error: 'conflict' });
    const nutrition = await post(app, {
      ...request,
      nutrition: { ...request.nutrition, protein: 18 },
    });
    expect(nutrition.status).toBe(409);
    const stored = await queryRows(
      database.db,
      sql`select name, protein from products where id = ${request.id}`,
    );
    expect(stored).toEqual([{ name: 'Homemade curd', protein: 17 }]);
  });

  it('#64-8: another user sending the same id is a conflict too, even with the same content', async () => {
    await post(app, request);
    expect((await post(appB, request)).status).toBe(409);
  });

  it('an id of a seed product is a conflict', async () => {
    const seeded = seedData.products[0]!;
    const res = await post(app, { ...request, id: seeded.id });
    expect(res.status).toBe(409);
  });

  it('an unknown ingredient class is refused on that field', async () => {
    const res = await post(app, { ...request, ingredientClassId: 'no-such-class' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ issues: [{ path: 'ingredientClassId' }] });
    expect(await rows()).toEqual([]);
  });

  it.each([
    ['a negative value', { fat: -1 }],
    ['a value above 100 g', { sugars: 101 }],
    ['carbs, protein and fat above 100 g', { carbs: 50, protein: 40, fat: 20 }],
  ])('#64-2: refuses %s with 400', async (_name, change) => {
    const res = await post(app, { ...request, nutrition: { ...request.nutrition, ...change } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_request' });
    expect(await rows()).toEqual([]);
  });

  it('refuses a request without a session', async () => {
    const res = await createApp({ db: database.db }).request('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    expect(res.status).toBe(401);
  });
});
