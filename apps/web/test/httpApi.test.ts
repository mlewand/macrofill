import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createHttpApi } from '../src/api/api';
import { createApiClient } from '../src/api/client';

describe('the http api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
});
