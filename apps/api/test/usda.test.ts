import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createUsdaProvider, mapUsda } from '../src/lookup/usda';

// Recorded from the real API on 2026-10-03:
// GET https://api.nal.usda.gov/fdc/v1/foods/search?query=<gtin>&dataType=Branded&pageSize=5
// (one hit, kept to its first food, and an empty result). CI never calls it.
const fixture = (name: string) => ({
  status: Number(readFileSync(new URL(`./fixtures/usda/${name}.status`, import.meta.url), 'utf8')),
  body: JSON.parse(
    readFileSync(new URL(`./fixtures/usda/${name}.body`, import.meta.url), 'utf8'),
  ) as unknown,
});

/** The barcode of the recorded hit, in the store's 13 digits (its gtinUpc is the 12-digit UPC-A). */
const BARCODE = '0016000275683';

describe('#67-3: mapping a USDA FoodData Central food', () => {
  it('maps a branded food: name, brand, the per-100 g values and the fdcId as the reference', () => {
    expect(mapUsda(fixture('branded-hit').body, BARCODE)).toEqual({
      source: 'usda-fdc',
      sourceRef: '1636115',
      // USDA writes descriptions in capitals; the form is for the user to check and keep.
      name: 'Frosted Corn Puffs',
      // The brand (not the owner, General Mills, Inc.), readable like the name.
      brand: 'Cocoa Puffs',
      nutrition: {
        kcal: 370,
        fat: 5.56,
        saturates: 0,
        carbs: 85.2,
        sugars: 33.3,
        protein: 3.7,
        // No salt in USDA data: it stays unknown, sodium is not converted.
        salt: null,
        fibre: 3.7,
      },
    });
  });

  it('is a miss for an empty result', () => {
    expect(mapUsda(fixture('no-hits').body, BARCODE)).toBeUndefined();
  });

  it('is a miss when the food found is for another barcode: the search is full-text, not exact', () => {
    expect(mapUsda(fixture('branded-hit').body, '0049000028911')).toBeUndefined();
    // And the gtin is compared as the store's 13 digits, whatever form USDA has it in.
    expect(mapUsda(fixture('branded-hit').body, '0000016000275')).toBeUndefined();
  });

  const food = (rest: Record<string, unknown>) => ({
    foods: [
      { fdcId: 7, gtinUpc: '016000275683', description: 'Thing', dataType: 'Branded', ...rest },
    ],
  });

  it('takes the matching food among several results', () => {
    const body = {
      foods: [
        { fdcId: 1, gtinUpc: '999999999999', description: 'Other', dataType: 'Branded' },
        { fdcId: 2, gtinUpc: '016000275683', description: 'Mine', dataType: 'Branded' },
      ],
    };
    expect(mapUsda(body, BARCODE)).toMatchObject({ sourceRef: '2', name: 'Mine' });
  });

  it('#67-3: of several revisions of the same barcode, the newest published one is the current product (regression: #76)', () => {
    const revision = (fdcId: number, publishedDate: string | undefined, protein: number) => ({
      fdcId,
      gtinUpc: '016000275683',
      description: `Revision ${fdcId}`,
      dataType: 'Branded',
      ...(publishedDate === undefined ? {} : { publishedDate }),
      foodNutrients: [{ nutrientNumber: '203', unitName: 'G', value: protein }],
    });
    const body = {
      foods: [
        revision(1, '2019-04-01', 1),
        revision(3, '2021-12-30', 3),
        revision(2, '2020-06-15', 2),
        revision(4, undefined, 4),
      ],
    };
    expect(mapUsda(body, BARCODE)).toMatchObject({ sourceRef: '3', name: 'Revision 3' });
    // Whatever order the search returns them in.
    expect(mapUsda({ foods: [...body.foods].reverse() }, BARCODE)?.sourceRef).toBe('3');
    // Without any date, the first one stands.
    expect(
      mapUsda({ foods: [revision(5, undefined, 5), revision(6, undefined, 6)] }, BARCODE)
        ?.sourceRef,
    ).toBe('5');
  });

  it('only energy in kcal counts, and only values in grams', () => {
    const candidate = mapUsda(
      food({
        foodNutrients: [
          { nutrientNumber: '208', unitName: 'KCAL', value: 100 },
          { nutrientNumber: '268', unitName: 'KJ', value: 418 },
          { nutrientNumber: '203', unitName: 'MG', value: 5000 },
          { nutrientNumber: '204', unitName: 'G', value: '2,5' },
          { nutrientNumber: '205', unitName: 'G', value: -1 },
        ],
      }),
      BARCODE,
    );
    expect(candidate?.nutrition).toMatchObject({
      kcal: 100,
      protein: null,
      fat: 2.5,
      carbs: null,
    });
  });

  it('a food without nutrients, a brand or a mixed-case name is still a hit, as is', () => {
    expect(mapUsda(food({ description: 'Mixed Case Name' }), BARCODE)).toMatchObject({
      name: 'Mixed Case Name',
    });
    expect(mapUsda(food({}), BARCODE)).not.toHaveProperty('brand');
    expect(mapUsda(food({ brandName: 'Brandy', brandOwner: 'Owner Inc' }), BARCODE)?.brand).toBe(
      'Brandy',
    );
  });

  it.each([null, 'x', 1, [], {}, { foods: 'x' }, { foods: [null] }, { foods: [{ gtinUpc: 5 }] }])(
    'does not trust an answer of another shape: %j is a miss',
    (body) => {
      expect(mapUsda(body, BARCODE)).toBeUndefined();
    },
  );
});

describe('the USDA provider', () => {
  const options = { baseUrl: 'https://usda.test', apiKey: 'secret-key', timeoutMs: 5000 };
  const respond = (status: number, body: unknown) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  const lookup = (fetch: typeof globalThis.fetch, barcode = BARCODE) =>
    createUsdaProvider({ ...options, fetch }).lookup(barcode);

  it('is identified as usda-fdc', () => {
    expect(createUsdaProvider({ ...options, fetch: vi.fn() }).id).toBe('usda-fdc');
  });

  it('#67-3: searches the Branded Foods by the barcode, with the key', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => {
      const { status, body } = fixture('branded-hit');
      return Promise.resolve(respond(status, body));
    });
    expect(await lookup(fetch)).toMatchObject({
      result: 'hit',
      candidate: { sourceRef: '1636115' },
    });
    const requested = new URL(fetch.mock.calls[0]![0]);
    expect(requested.origin + requested.pathname).toBe('https://usda.test/fdc/v1/foods/search');
    expect(requested.searchParams.get('query')).toBe('016000275683');
    expect(requested.searchParams.get('dataType')).toBe('Branded');
    expect(requested.searchParams.get('api_key')).toBe('secret-key');
    expect(fetch.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('asks with the 13 digits when the barcode has no leading zero, and the 12-digit UPC-A otherwise', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(respond(200, { foods: [] })),
    );
    await lookup(fetch, '3017620422003');
    expect(new URL(fetch.mock.calls[0]![0] as string).searchParams.get('query')).toBe(
      '3017620422003',
    );
    await lookup(fetch, '0000096385074');
    expect(new URL(fetch.mock.calls[1]![0] as string).searchParams.get('query')).toBe(
      '000096385074',
    );
  });

  it('an empty result is a miss', async () => {
    const { status, body } = fixture('no-hits');
    expect(await lookup(() => Promise.resolve(respond(status, body)))).toEqual({ result: 'miss' });
  });

  it('a refused key, rate limiting, a server error, a network failure and an unreadable answer are errors', async () => {
    for (const status of [403, 429, 500]) {
      expect(await lookup(() => Promise.resolve(respond(status, '{"error":"x"}')))).toEqual({
        result: 'error',
      });
    }
    expect(await lookup(() => Promise.reject(new TypeError('fetch failed')))).toEqual({
      result: 'error',
    });
    expect(await lookup(() => Promise.resolve(respond(200, 'not json')))).toEqual({
      result: 'error',
    });
  });

  it('no answer within the time is a timeout, and so is the whole lookup running out', async () => {
    const hang = (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const own = createUsdaProvider({ ...options, timeoutMs: 20, fetch: hang });
    expect(await own.lookup(BARCODE)).toEqual({ result: 'timeout' });
    const total = new AbortController();
    const other = createUsdaProvider({ ...options, fetch: hang });
    const pending = other.lookup(BARCODE, { signal: total.signal });
    total.abort();
    expect(await pending).toEqual({ result: 'timeout' });
  });

  it('never puts the key in an error or a result', async () => {
    const result = await lookup(() => Promise.reject(new Error('failed: secret-key')));
    expect(JSON.stringify(result)).not.toContain('secret-key');
  });
});
