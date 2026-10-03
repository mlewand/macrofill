import type { Catalog, SaveMealRequest, SaveMealResponse, Today } from '@macrofill/domain';
import { vi } from 'vitest';
import type { Api } from '../../src/api/api';

export const emptyToday: Today = {
  timezone: 'Europe/Warsaw',
  day: '2026-01-15',
  targets: { protein: null, fat: null, carbs: null, fibre: null, kcal: null },
  totals: { kcal: 0, fat: 0, saturates: 0, carbs: 0, sugars: 0, protein: 0, salt: 0, fibre: 0 },
  entries: [],
};

export const emptyCatalog: Catalog = { ingredientClasses: [], recipes: [], products: [] };

export const stored = (request: SaveMealRequest): SaveMealResponse => ({
  meal: request.meal,
  consumptionEntry: { ...request.consumptionEntry, preparedMealId: request.meal.id },
});

/** A fake Api for component tests; every method is a spy, and any can be overridden. */
export function fakeApi(overrides: Partial<Api> = {}): Api {
  return {
    login: vi.fn(overrides.login ?? (() => Promise.resolve('ok' as const))),
    me: vi.fn(overrides.me ?? (() => Promise.resolve('mlewand'))),
    catalog: vi.fn(overrides.catalog ?? (() => Promise.resolve(emptyCatalog))),
    saveMeal: vi.fn(overrides.saveMeal ?? ((request) => Promise.resolve(stored(request)))),
    createProduct: vi.fn(
      overrides.createProduct ??
        ((request) => Promise.resolve({ ...request, source: 'manual' as const, lastUsedAt: null })),
    ),
    productByBarcode: vi.fn(overrides.productByBarcode ?? (() => Promise.resolve(undefined))),
    today: vi.fn(overrides.today ?? (() => Promise.resolve(emptyToday))),
    deleteEntry: vi.fn(overrides.deleteEntry ?? (() => Promise.resolve())),
    sendEvents: vi.fn(overrides.sendEvents ?? (() => Promise.resolve())),
  };
}
