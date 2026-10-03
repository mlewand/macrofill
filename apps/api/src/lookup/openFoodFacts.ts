import type { NutritionValues, ProductCandidate } from '@macrofill/domain';
import type { ProductLookupProvider, ProviderResult } from './provider';

// Open Food Facts (#66): https://world.openfoodfacts.org, free and open data (ODbL). Its v2 product
// endpoint answers a barcode in any of its forms: the store's padded 13 digits find an EAN-8 or a
// UPC-A too (checked against the live API on 2026-10-03).

const FIELDS = 'code,product_name,brands,nutriments';

/**
 * A per-100 g value from a nutriments entry. OFF sends numbers, sometimes numeric strings; anything
 * else, a negative or an infinite number is unknown. Float noise (`1.2700000286102295`) is trimmed.
 */
function amount(value: unknown): number | null {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+([.,]\d+)?$/.test(value.trim())
        ? Number(value.trim().replace(',', '.'))
        : NaN;
  return Number.isFinite(number) && number >= 0 ? Number(number.toFixed(3)) : null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * #66-2: an Open Food Facts answer as a candidate, or undefined if it has no product. Only the
 * `*_100g` values OFF states are taken: kcal from `energy-kcal_100g` and salt from `salt_100g`,
 * never derived from kJ or sodium, so a value OFF lacks stays unknown (M2-3).
 */
export function mapOpenFoodFacts(body: unknown): ProductCandidate | undefined {
  if (!isRecord(body) || body.status === 0) return undefined;
  const product = body.product;
  if (!isRecord(product)) return undefined;
  const code = [product.code, body.code].find(
    (c): c is string | number => (typeof c === 'string' && c !== '') || typeof c === 'number',
  );
  if (code === undefined) return undefined;
  const nutriments = isRecord(product.nutriments) ? product.nutriments : {};
  const nutrition: NutritionValues = {
    kcal: amount(nutriments['energy-kcal_100g']),
    fat: amount(nutriments.fat_100g),
    saturates: amount(nutriments['saturated-fat_100g']),
    carbs: amount(nutriments.carbohydrates_100g),
    sugars: amount(nutriments.sugars_100g),
    protein: amount(nutriments.proteins_100g),
    salt: amount(nutriments.salt_100g),
    fibre: amount(nutriments.fiber_100g),
  };
  const brand =
    typeof product.brands === 'string'
      ? product.brands
          .split(',')
          .map((b) => b.trim())
          .find((b) => b !== '')
      : undefined;
  return {
    source: 'openfoodfacts',
    sourceRef: String(code),
    name: typeof product.product_name === 'string' ? product.product_name.trim() : '',
    ...(brand === undefined ? {} : { brand }),
    nutrition,
  };
}

export interface OpenFoodFactsOptions {
  /** `https://world.openfoodfacts.org`; tests and e2e point it at a stub (no network in CI). */
  baseUrl: string;
  /** OFF asks for a descriptive one: the app, its version and a contact. */
  userAgent: string;
  /** How long it may take (#66-4). */
  timeoutMs: number;
  fetch?: typeof globalThis.fetch;
}

export function createOpenFoodFactsProvider(options: OpenFoodFactsOptions): ProductLookupProvider {
  const doFetch = options.fetch ?? globalThis.fetch;
  return {
    id: 'openfoodfacts',
    async lookup(barcode, { signal } = {}): Promise<ProviderResult> {
      const timeout = AbortSignal.timeout(options.timeoutMs);
      const url = new URL(`/api/v2/product/${barcode}`, options.baseUrl);
      url.searchParams.set('fields', FIELDS);
      try {
        const res = await doFetch(url, {
          headers: { 'User-Agent': options.userAgent, Accept: 'application/json' },
          signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
        });
        // A barcode OFF doesn't have is a 404 whose body says `status: 0`.
        if (res.status !== 200 && res.status !== 404) return { result: 'error' };
        const body: unknown = JSON.parse(await res.text());
        const candidate = mapOpenFoodFacts(body);
        if (candidate) return { result: 'hit', candidate };
        // A 404 that isn't OFF's own "not found" is something else answering.
        return res.status === 404 && !(isRecord(body) && body.status === 0)
          ? { result: 'error' }
          : { result: 'miss' };
      } catch {
        return { result: timeout.aborted ? 'timeout' : 'error' };
      }
    },
  };
}
