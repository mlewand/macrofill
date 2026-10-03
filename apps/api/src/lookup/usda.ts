import type { NutritionValues, ProductCandidate } from '@macrofill/domain';
import type { ProductLookupProvider, ProviderResult } from './provider';

// USDA FoodData Central (#67): https://fdc.nal.usda.gov, public domain (CC0), with a free data.gov
// API key. There is no lookup by barcode: the Branded Foods are searched for the code as text, and
// the foods found are checked for their own `gtinUpc`. How it behaves was checked against the live
// API on 2026-10-03 (recorded in issue #67).

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The store's 13-digit form of a GTIN (UPC-A and EAN-8 left-padded with zeros). */
const normalize = (gtin: string) => gtin.replace(/\D/g, '').padStart(13, '0');

/** USDA writes names in capitals (`FROSTED CORN PUFFS`); the form shows them readably. */
function readable(name: string): string {
  if (/[a-z]/.test(name)) return name;
  return name
    .toLowerCase()
    .replace(
      /(^|[\s(/-])([a-z])/g,
      (_, before: string, letter: string) => before + letter.toUpperCase(),
    );
}

/** A value in `unit` from a food's nutrients (per 100 g for Branded Foods), or null. */
function nutrient(nutrients: unknown[], number: string, unit: string): number | null {
  const found = nutrients.find((n) => isRecord(n) && String(n.nutrientNumber) === number);
  if (!isRecord(found) || found.unitName !== unit) return null;
  const value = found.value;
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+([.,]\d+)?$/.test(value.trim())
        ? Number(value.trim().replace(',', '.'))
        : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(3)) : null;
}

/**
 * #67-3: the food a search found for `barcode` (the store's 13 digits) as a candidate, or undefined.
 * The search is full-text, so only a food whose own `gtinUpc` is this barcode counts, and of its
 * revisions the newest published. Only values
 * USDA states are taken: it has no salt, which stays unknown (sodium is not converted), as for
 * Open Food Facts (M2-3).
 */
export function mapUsda(body: unknown, barcode: string): ProductCandidate | undefined {
  if (!isRecord(body) || !Array.isArray(body.foods)) return undefined;
  // Duplicate GTINs are revisions of the same product: the latest `publishedDate` (YYYY-MM-DD, so
  // it sorts as text) is the current one. A food without a date comes after those with one; among
  // equals the search's own order stands.
  const published = (f: Record<string, unknown>) =>
    typeof f.publishedDate === 'string' ? f.publishedDate : '';
  const food = body.foods
    .filter(
      (f): f is Record<string, unknown> =>
        isRecord(f) && typeof f.gtinUpc === 'string' && normalize(f.gtinUpc) === barcode,
    )
    .reduce<Record<string, unknown> | undefined>(
      (best, f) => (best === undefined || published(f) > published(best) ? f : best),
      undefined,
    );
  if (!food || (typeof food.fdcId !== 'number' && typeof food.fdcId !== 'string')) return undefined;
  const nutrients = Array.isArray(food.foodNutrients) ? food.foodNutrients : [];
  const nutrition: NutritionValues = {
    kcal: nutrient(nutrients, '208', 'KCAL'),
    fat: nutrient(nutrients, '204', 'G'),
    saturates: nutrient(nutrients, '606', 'G'),
    carbs: nutrient(nutrients, '205', 'G'),
    sugars: nutrient(nutrients, '269', 'G'),
    protein: nutrient(nutrients, '203', 'G'),
    salt: null,
    fibre: nutrient(nutrients, '291', 'G'),
  };
  const brand = [food.brandName, food.brandOwner].find(
    (b): b is string => typeof b === 'string' && b.trim() !== '',
  );
  return {
    source: 'usda-fdc',
    sourceRef: String(food.fdcId),
    name: typeof food.description === 'string' ? readable(food.description.trim()) : '',
    ...(brand === undefined ? {} : { brand: readable(brand.trim()) }),
    nutrition,
  };
}

export interface UsdaOptions {
  /** `https://api.nal.usda.gov`; tests and e2e point it at a stub (no network in CI). */
  baseUrl: string;
  /** The data.gov API key. Without one the provider isn't used (#67-5). */
  apiKey: string;
  /** How long it may take (#67-2). */
  timeoutMs: number;
  fetch?: typeof globalThis.fetch;
}

export function createUsdaProvider(options: UsdaOptions): ProductLookupProvider {
  const doFetch = options.fetch ?? globalThis.fetch;
  return {
    id: 'usda-fdc',
    async lookup(barcode, { signal } = {}): Promise<ProviderResult> {
      const timeout = AbortSignal.timeout(options.timeoutMs);
      const url = new URL('/fdc/v1/foods/search', options.baseUrl);
      // USDA holds a UPC-A as its 12 digits: the store's padding is taken off one zero.
      url.searchParams.set('query', barcode.startsWith('0') ? barcode.slice(1) : barcode);
      url.searchParams.set('dataType', 'Branded');
      url.searchParams.set('pageSize', '5');
      url.searchParams.set('api_key', options.apiKey);
      try {
        const res = await doFetch(url, {
          headers: { Accept: 'application/json' },
          signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
        });
        // A miss is a 200 with no foods; a refused key, rate limiting or a failure is anything else.
        if (res.status !== 200) return { result: 'error' };
        const candidate = mapUsda(JSON.parse(await res.text()), barcode);
        return candidate ? { result: 'hit', candidate } : { result: 'miss' };
      } catch {
        return { result: timeout.aborted || signal?.aborted ? 'timeout' : 'error' };
      }
    },
  };
}
