import { LOOKUP_CLIENT_TIMEOUT_MS } from '@macrofill/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createHttpApi } from '../src/api/api';
import { createApiClient } from '../src/api/client';

describe('the http api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('M7-8: sending events gives up after a while, and still goes out as the page is left (regression: #52)', async () => {
    let init: RequestInit | undefined;
    // A request that never gets an answer.
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: unknown, given?: RequestInit) => {
        init = given;
        return new Promise<Response>(() => undefined);
      }),
    );
    const api = createHttpApi(createApiClient('http://localhost/api'));
    void api.sendEvents([]);
    await vi.waitFor(() => expect(init).toBeDefined());
    // Like saveMeal: it fails after a while, so the tracker's retry can run.
    expect(init!.signal).toBeInstanceOf(AbortSignal);
    expect(init!.keepalive).toBe(true);
  });

  const product = {
    id: '4f0c7a3e-3b8e-4d7a-9a51-6c1f2d9e8b01',
    ingredientClassId: 'curd',
    name: 'Homemade curd',
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
  const stub = (response: () => Response) => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(response()));
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  it('#64-4, #64-8: adding a product posts it, and a 201 or a 200 for a retry both give the product', async () => {
    const stored = { ...product, source: 'manual', lastUsedAt: null };
    for (const status of [201, 200]) {
      const fetch = stub(() => json(stored, status));
      const api = createHttpApi(createApiClient('http://localhost/api'));
      expect(await api.createProduct(product)).toEqual(stored);
      const [url, init] = fetch.mock.calls[0]!;
      expect(url).toBe('http://localhost/api/products');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual(product);
      // Like a save, it fails after a while instead of hanging.
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each([400, 401, 409, 500])(
    '#64-4: a %d from the server is an ApiError with its status',
    async (status) => {
      stub(() => json({ error: 'x' }, status));
      const api = createHttpApi(createApiClient('http://localhost/api'));
      await expect(api.createProduct(product)).rejects.toMatchObject({ status });
      await expect(api.createProduct(product)).rejects.toBeInstanceOf(ApiError);
    },
  );

  it('#65-3: the lookup gives the product for a barcode, and nothing for an unknown one', async () => {
    const stored = { ...product, source: 'manual', lastUsedAt: null };
    const fetch = stub(() => json(stored, 200));
    const api = createHttpApi(createApiClient('http://localhost/api'));
    expect(await api.productByBarcode('5901234123457')).toEqual(stored);
    expect(fetch.mock.calls[0]![0]).toBe('http://localhost/api/products/by-barcode/5901234123457');
    stub(() => json({ error: 'not_found' }, 404));
    expect(await api.productByBarcode('5901234123457')).toBeUndefined();
  });

  it('#65-3: any other answer to the lookup is an error, not an unknown product', async () => {
    const api = createHttpApi(createApiClient('http://localhost/api'));
    for (const status of [400, 401, 500]) {
      stub(() => json({ error: 'x' }, status));
      await expect(api.productByBarcode('5901234123457')).rejects.toMatchObject({ status });
    }
    // Like a save, it gives up after a while.
    const fetch = stub(() => json({}, 404));
    await api.productByBarcode('5901234123457');
    expect(fetch.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('#65-4: a 409 for a taken barcode says which kind of conflict it is', async () => {
    const api = createHttpApi(createApiClient('http://localhost/api'));
    stub(() => json({ error: 'barcode_taken' }, 409));
    await expect(api.createProduct(product)).rejects.toMatchObject({
      status: 409,
      code: 'barcode_taken',
    });
    stub(() => json({ error: 'conflict' }, 409));
    await expect(api.createProduct(product)).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
    });
  });

  it('#66-1: the lookup of an unknown barcode goes to our own server, and gives up after a while', async () => {
    const answer = {
      candidate: {
        source: 'openfoodfacts',
        sourceRef: '3017620422003',
        name: 'Nutella',
        nutrition: { ...product.nutrition, kcal: 539 },
      },
      attempts: [{ provider: 'openfoodfacts', result: 'hit' }],
    };
    const fetch = stub(() => json(answer, 200));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const api = createHttpApi(createApiClient('http://localhost/api'));
    expect(await api.lookupProduct('3017620422003')).toEqual(answer);
    // Beyond what the server can be set to take, so its answer is never cut short (regression: #74).
    expect(timeout).toHaveBeenCalledWith(LOOKUP_CLIENT_TIMEOUT_MS);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://localhost/api/product-lookup/3017620422003');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    stub(() => json({ error: 'x' }, 500));
    await expect(api.lookupProduct('3017620422003')).rejects.toMatchObject({ status: 500 });
  });

  it('a 400 for a product carries the fields the server named (regression: #94)', async () => {
    const issues = [{ path: 'nutrition.fat', message: 'x' }];
    stub(() => json({ error: 'invalid_request', issues }, 400));
    const api = createHttpApi(createApiClient('http://localhost/api'));
    await expect(api.createProduct(product)).rejects.toMatchObject({
      status: 400,
      code: 'invalid_request',
      issues,
    });
    // Anything it says that isn't that shape is ignored.
    stub(() => json({ error: 'invalid_request', issues: 'nope' }, 400));
    await expect(api.createProduct(product)).rejects.toMatchObject({ status: 400, issues: [] });
  });
});
