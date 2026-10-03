import {
  lookupResponseSchema,
  type CatalogProduct,
  type ProductCandidate,
} from '@macrofill/domain';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { queryRows, type Database } from '../src/db/client';
import type { ProductLookupProvider, ProviderResult } from '../src/lookup/provider';
import { seed } from '../src/seed/seed';
import { createMigratedTestDatabase } from './support/db';
import { signedIn, type TestApp } from './support/session';

const candidate: ProductCandidate = {
  source: 'openfoodfacts',
  sourceRef: '3017620422003',
  name: 'Nutella',
  brand: 'Ferrero',
  nutrition: {
    kcal: 539,
    fat: 30.9,
    saturates: 10.6,
    carbs: 57.5,
    sugars: 56.3,
    protein: 6.3,
    salt: 0.107,
    fibre: null,
  },
};

const provider = (result: ProviderResult, id = 'openfoodfacts') => {
  const lookup = vi.fn<ProductLookupProvider['lookup']>(() => Promise.resolve(result));
  return { id, lookup } satisfies ProductLookupProvider;
};

describe('GET /api/product-lookup/:code (#66-1)', () => {
  let database: Database;

  beforeEach(async () => {
    database = await createMigratedTestDatabase();
    await seed(database.db);
  });

  afterEach(async () => {
    await database.close();
  });

  const client = (...providers: ProductLookupProvider[]): Promise<TestApp> =>
    signedIn(createApp({ db: database.db, lookupProviders: providers }), database.db);
  const get = (app: TestApp, code: string) =>
    app.request(`/api/product-lookup/${encodeURIComponent(code)}`);

  it('#66-2: a hit gives the candidate, and who was asked', async () => {
    const off = provider({ result: 'hit', candidate });
    const res = await get(await client(off), '3017620422003');
    expect(res.status).toBe(200);
    expect(lookupResponseSchema.parse(await res.json())).toEqual({
      candidate,
      attempts: [{ provider: 'openfoodfacts', result: 'hit' }],
    });
    expect(off.lookup).toHaveBeenCalledOnce();
    expect(off.lookup.mock.calls[0]![0]).toBe('3017620422003');
  });

  it.each(['miss', 'error', 'timeout'] as const)(
    '#66-4: %s is still an answer, with no candidate: the user gets the empty form, never an error',
    async (result) => {
      const res = await get(await client(provider({ result })), '3017620422003');
      expect(res.status).toBe(200);
      expect(lookupResponseSchema.parse(await res.json())).toEqual({
        attempts: [{ provider: 'openfoodfacts', result }],
      });
    },
  );

  it('#66-1, #65-2: the provider is asked with the stored 13 digits, whatever form was sent', async () => {
    const off = provider({ result: 'miss' });
    const app = await client(off);
    await get(app, '036000291452');
    await get(app, '96385074');
    expect(off.lookup.mock.calls.map(([code]) => code)).toEqual(['0036000291452', '0000096385074']);
  });

  it('#66-1: a code that is not a barcode is refused, and no provider is asked', async () => {
    const off = provider({ result: 'miss' });
    const app = await client(off);
    for (const code of ['5901234123458', '123', 'abc']) {
      const res = await get(app, code);
      expect(res.status, code).toBe(400);
      expect(await res.json()).toMatchObject({
        error: 'invalid_request',
        issues: [{ path: 'code' }],
      });
    }
    expect(off.lookup).not.toHaveBeenCalled();
  });

  it('with no providers configured, there is nothing to ask: no attempts, no candidate', async () => {
    const res = await get(await client(), '3017620422003');
    expect(lookupResponseSchema.parse(await res.json())).toEqual({ attempts: [] });
  });

  it('a provider that throws, against its contract, is an error and not a failed request', async () => {
    const broken: ProductLookupProvider = {
      id: 'openfoodfacts',
      lookup: () => Promise.reject(new Error('boom')),
    };
    const res = await get(await client(broken), '3017620422003');
    expect(res.status).toBe(200);
    expect(lookupResponseSchema.parse(await res.json())).toEqual({
      attempts: [{ provider: 'openfoodfacts', result: 'error' }],
    });
  });

  it('needs a session', async () => {
    const app = createApp({ db: database.db, lookupProviders: [provider({ result: 'miss' })] });
    expect((await app.request('/api/product-lookup/3017620422003')).status).toBe(401);
  });
});

describe('#66-3: saving a product that came from a provider', () => {
  let database: Database;
  let app: TestApp;
  const request = {
    id: '4f0c7a3e-3b8e-4d7a-9a51-6c1f2d9e8b01',
    ingredientClassId: 'cream-cheese',
    name: 'Nutella',
    brand: 'Ferrero',
    barcode: '3017620422003',
    nutrition: candidate.nutrition,
    lookup: { source: 'openfoodfacts', ref: '3017620422003' },
  };

  beforeEach(async () => {
    database = await createMigratedTestDatabase();
    await seed(database.db);
    app = await signedIn(createApp({ db: database.db }), database.db);
  });

  afterEach(async () => {
    await database.close();
  });

  const post = (body: unknown) =>
    app.request('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('stores the source and the provider’s reference, and nothing was stored before the save', async () => {
    expect(
      await queryRows(database.db, sql`select id from products where barcode = ${request.barcode}`),
    ).toEqual([]);
    const res = await post(request);
    expect(res.status).toBe(201);
    expect((await res.json()) as CatalogProduct).toMatchObject({ source: 'openfoodfacts' });
    expect(
      await queryRows(
        database.db,
        sql`select source, source_ref, barcode from products where id = ${request.id}`,
      ),
    ).toEqual([{ source: 'openfoodfacts', source_ref: '3017620422003', barcode: '3017620422003' }]);
  });

  it('a retry is a replay, and the same id from another source is a conflict (#64-8)', async () => {
    expect((await post(request)).status).toBe(201);
    expect((await post(request)).status).toBe(200);
    const typed = { ...request, lookup: undefined };
    const other = await post(typed);
    expect(other.status).toBe(409);
    expect(await other.json()).toEqual({ error: 'conflict' });
  });

  it('a product typed in has source manual and no reference', async () => {
    await post({ ...request, lookup: undefined });
    expect(
      await queryRows(
        database.db,
        sql`select source, source_ref from products where id = ${request.id}`,
      ),
    ).toEqual([{ source: 'manual', source_ref: null }]);
  });

  it('refuses a source this build does not write', async () => {
    const res = await post({ ...request, lookup: { source: 'seed', ref: 'x' } });
    expect(res.status).toBe(400);
  });

  it('the database refuses a source it does not know', async () => {
    await expect(
      database.db.execute(
        sql`insert into products (id, ingredient_class_id, name, source)
            values (gen_random_uuid(), 'curd', 'x', 'invented')`,
      ),
    ).rejects.toThrow();
  });
});
