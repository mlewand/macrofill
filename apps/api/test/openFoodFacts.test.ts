import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createOpenFoodFactsProvider, mapOpenFoodFacts } from '../src/lookup/openFoodFacts';

// Recorded from the real API (world.openfoodfacts.org/api/v2/product/<code>?fields=code,product_name,
// brands,nutriments) on 2026-10-03. CI never calls it.
const fixture = (name: string) => ({
  status: Number(
    readFileSync(new URL(`./fixtures/openfoodfacts/${name}.status`, import.meta.url), 'utf8'),
  ),
  body: JSON.parse(
    readFileSync(new URL(`./fixtures/openfoodfacts/${name}.body`, import.meta.url), 'utf8'),
  ) as unknown,
});

describe('#66-2: mapping an Open Food Facts product', () => {
  it('maps a full product: name, first brand, the per-100 g values, the reference', () => {
    expect(mapOpenFoodFacts(fixture('nutella-ean13').body)).toEqual({
      source: 'openfoodfacts',
      sourceRef: '3017620422003',
      name: 'Nutella',
      brand: 'Nutella',
      nutrition: {
        kcal: 539,
        fat: 30.9,
        saturates: 10.6,
        carbs: 57.5,
        sugars: 56.3,
        protein: 6.3,
        salt: 0.107,
        // OFF states 0 here: that is a value, and stays 0.
        fibre: 0,
      },
    });
  });

  it('#66-2: a value the product lacks is unknown, never 0 (M2-3)', () => {
    const candidate = mapOpenFoodFacts(fixture('sparse-la-lumbre').body);
    expect(candidate).toMatchObject({ name: 'Sauce chiltepin', brand: 'La lumbre' });
    expect(candidate?.nutrition.fibre).toBeNull();
    expect(candidate?.nutrition.protein).toBe(2.8);
  });

  it('uses the code OFF gives back as the reference, which is the EAN-8 for a padded query', () => {
    const candidate = mapOpenFoodFacts(fixture('ean8-nutella').body);
    expect(candidate?.sourceRef).toBe('80177173');
    expect(candidate?.brand).toBe('Ferrero');
  });

  it('is a miss for a barcode OFF does not have', () => {
    expect(mapOpenFoodFacts(fixture('not-found').body)).toBeUndefined();
  });

  const product = (nutriments: unknown, rest: Record<string, unknown> = {}) => ({
    status: 1,
    code: '123',
    product: { code: '123', product_name: 'X', nutriments, ...rest },
  });

  it('accepts numbers and numeric strings, and makes anything else unknown', () => {
    const candidate = mapOpenFoodFacts(
      product({
        'energy-kcal_100g': '250',
        fat_100g: '3,5',
        'saturated-fat_100g': 'lots',
        carbohydrates_100g: null,
        sugars_100g: -2,
        proteins_100g: Infinity,
        salt_100g: '',
        fiber_100g: [1],
      }),
    );
    expect(candidate?.nutrition).toEqual({
      kcal: 250,
      fat: 3.5,
      saturates: null,
      carbs: null,
      sugars: null,
      protein: null,
      salt: null,
      fibre: null,
    });
  });

  it('takes kcal only from energy-kcal_100g and salt only from salt_100g, never derived', () => {
    const candidate = mapOpenFoodFacts(
      product({ 'energy-kj_100g': 1046, energy_100g: 1046, sodium_100g: 0.4 }),
    );
    expect(candidate?.nutrition.kcal).toBeNull();
    expect(candidate?.nutrition.salt).toBeNull();
  });

  it('trims float noise from stored values', () => {
    const candidate = mapOpenFoodFacts(
      product({ fat_100g: 1.2700000286102295, 'energy-kcal_100g': 42.400000000000006 }),
    );
    expect(candidate?.nutrition.fat).toBe(1.27);
    expect(candidate?.nutrition.kcal).toBe(42.4);
  });

  it('a product without nutriments, a name or a brand is still a hit, with unknown values', () => {
    const candidate = mapOpenFoodFacts({ status: 1, code: '123', product: { code: '123' } });
    expect(candidate).toEqual({
      source: 'openfoodfacts',
      sourceRef: '123',
      name: '',
      nutrition: {
        kcal: null,
        fat: null,
        saturates: null,
        carbs: null,
        sugars: null,
        protein: null,
        salt: null,
        fibre: null,
      },
    });
  });

  it('takes the first of several brands, trimmed', () => {
    expect(mapOpenFoodFacts(product({}, { brands: ' Zott , Other ' }))?.brand).toBe('Zott');
    expect(mapOpenFoodFacts(product({}, { brands: '' }))).not.toHaveProperty('brand');
  });

  it.each([null, 'text', 42, [], {}, { status: 1 }, { status: 1, product: 'x' }])(
    'does not trust an answer of another shape: %j is a miss',
    (body) => {
      expect(mapOpenFoodFacts(body)).toBeUndefined();
    },
  );
});

describe('the Open Food Facts provider', () => {
  const options = {
    baseUrl: 'https://off.test',
    userAgent: 'Macrofill/abc1234 (macrofill_app@mlewandowski.com)',
    timeoutMs: 5000,
  };
  const respond = (status: number, body: unknown) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

  const lookup = async (fetch: typeof globalThis.fetch, barcode = '3017620422003') =>
    createOpenFoodFactsProvider({ ...options, fetch }).lookup(barcode);

  it('#66-1: asks the v2 product endpoint with a fields filter and a descriptive User-Agent', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => {
      const { status, body } = fixture('nutella-ean13');
      return Promise.resolve(respond(status, body));
    });
    const result = await lookup(fetch);
    expect(result).toMatchObject({ result: 'hit', candidate: { name: 'Nutella' } });
    const [url, init] = fetch.mock.calls[0]!;
    const requested = new URL(url);
    expect(requested.origin + requested.pathname).toBe(
      'https://off.test/api/v2/product/3017620422003',
    );
    expect(requested.searchParams.get('fields')).toBe('code,product_name,brands,nutriments');
    expect(new Headers(init?.headers).get('User-Agent')).toBe(options.userAgent);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('asks with the stored 13 digits: OFF finds an EAN-8 or UPC-A by its padded form', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => {
      const { status, body } = fixture('ean8-nutella');
      return Promise.resolve(respond(status, body));
    });
    expect(await lookup(fetch, '0000080177173')).toMatchObject({ result: 'hit' });
    expect(String(fetch.mock.calls[0]![0] as string | URL)).toContain('/product/0000080177173');
  });

  it('#66-4: a barcode OFF does not have is a miss: its 404 with status 0, or a 200 with status 0', async () => {
    const { status, body } = fixture('not-found');
    expect(status).toBe(404);
    expect(await lookup(() => Promise.resolve(respond(status, body)))).toEqual({ result: 'miss' });
    expect(await lookup(() => Promise.resolve(respond(200, body)))).toEqual({ result: 'miss' });
  });

  it('#66-4: rate limiting, a server error, a network failure and an unreadable answer are errors', async () => {
    expect(
      await lookup(() => Promise.resolve(respond(429, '<html>Too Many Requests</html>'))),
    ).toEqual({ result: 'error' });
    expect(await lookup(() => Promise.resolve(respond(500, '{}')))).toEqual({ result: 'error' });
    expect(await lookup(() => Promise.reject(new TypeError('fetch failed')))).toEqual({
      result: 'error',
    });
    expect(await lookup(() => Promise.resolve(respond(200, 'not json')))).toEqual({
      result: 'error',
    });
  });

  it('#66-4: no answer within the time is a timeout, and the request is cancelled', async () => {
    let signal: AbortSignal | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const provider = createOpenFoodFactsProvider({ ...options, timeoutMs: 20, fetch });
    expect(await provider.lookup('3017620422003')).toEqual({ result: 'timeout' });
    expect(signal?.aborted).toBe(true);
  });

  it('is identified as openfoodfacts', () => {
    expect(createOpenFoodFactsProvider({ ...options, fetch: vi.fn() }).id).toBe('openfoodfacts');
  });

  it('#67-2: the whole lookup running out is a timeout too, not an error', async () => {
    const total = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const pending = createOpenFoodFactsProvider({ ...options, fetch }).lookup('3017620422003', {
      signal: total.signal,
    });
    total.abort();
    expect(await pending).toEqual({ result: 'timeout' });
  });
});
