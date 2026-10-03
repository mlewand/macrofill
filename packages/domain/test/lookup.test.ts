import { describe, expect, it } from 'vitest';
import {
  createProductRequestSchema,
  LOOKUP_CLIENT_TIMEOUT_MS,
  lookupResponseSchema,
  MAX_LOOKUP_TIMEOUT_MS,
  productSchema,
  usageEventSchema,
} from '../src/index.js';

const nutrition = {
  kcal: 539,
  fat: 30.9,
  saturates: 10.6,
  carbs: 57.5,
  sugars: 56.3,
  protein: 6.3,
  salt: 0.107,
  fibre: null,
};

describe('#66-2: a lookup answer', () => {
  it('has a candidate with unknown values as null, and what each provider said', () => {
    const answer = {
      candidate: {
        source: 'openfoodfacts',
        sourceRef: '3017620422003',
        name: 'Nutella',
        brand: 'Ferrero',
        nutrition,
      },
      attempts: [{ provider: 'openfoodfacts', result: 'hit' }],
    };
    expect(lookupResponseSchema.parse(answer)).toEqual(answer);
  });

  it('may have no candidate, for a miss, an error or a timeout', () => {
    for (const result of ['miss', 'error', 'timeout'] as const) {
      const answer = { attempts: [{ provider: 'openfoodfacts', result }] };
      expect(lookupResponseSchema.parse(answer)).toEqual(answer);
    }
    expect(lookupResponseSchema.parse({ attempts: [] })).toEqual({ attempts: [] });
  });

  it('reads a provider this build does not know, so a deploy never breaks an open tab (#67 adds more)', () => {
    const answer = {
      candidate: { source: 'a-new-provider', sourceRef: 'x', name: 'Y', nutrition },
      attempts: [{ provider: 'a-new-provider', result: 'hit' }],
    };
    expect(lookupResponseSchema.safeParse(answer).success).toBe(true);
  });
});

describe('#66-3: saving a product that came from a provider', () => {
  const request = {
    id: '4f0c7a3e-3b8e-4d7a-9a51-6c1f2d9e8b01',
    ingredientClassId: 'cream-cheese',
    name: 'Nutella',
    barcode: '3017620422003',
    nutrition,
  };

  it('carries the provider and its reference, from the providers this build writes', () => {
    const lookup = { source: 'openfoodfacts', ref: '3017620422003' };
    expect(createProductRequestSchema.parse({ ...request, lookup }).lookup).toEqual(lookup);
    expect(createProductRequestSchema.parse(request).lookup).toBeUndefined();
  });

  it('refuses a source it does not write, an empty reference, and `seed` or `manual` as a lookup', () => {
    for (const lookup of [
      { source: 'a-new-provider', ref: 'x' },
      { source: 'openfoodfacts', ref: '' },
      { source: 'manual', ref: 'x' },
      { source: 'seed', ref: 'x' },
    ]) {
      expect(createProductRequestSchema.safeParse({ ...request, lookup }).success).toBe(false);
    }
  });
});

describe('reading a product stays tolerant (the source may be one this build does not know)', () => {
  it('accepts any non-empty source on read', () => {
    const product = {
      id: '4f0c7a3e-3b8e-4d7a-9a51-6c1f2d9e8b01',
      ingredientClassId: 'curd',
      name: 'x',
      nutrition,
      source: 'openfoodfacts',
    };
    expect(productSchema.safeParse(product).success).toBe(true);
    expect(productSchema.safeParse({ ...product, source: 'usda-fdc' }).success).toBe(true);
    expect(productSchema.safeParse({ ...product, source: '' }).success).toBe(false);
  });
});

describe('#66-6: the product lookup usage event', () => {
  const base = {
    id: 'f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b',
    clientSessionId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    occurredAt: '2026-01-15T07:00:00.000Z',
    appVersion: 'abc1234',
  };

  it('records each provider tried and its result, with nothing that identifies the product', () => {
    const event = {
      ...base,
      name: 'product_lookup',
      props: {
        attempts: [
          { provider: 'openfoodfacts', result: 'miss' },
          { provider: 'usda-fdc', result: 'hit' },
        ],
      },
    };
    expect(usageEventSchema.parse(event)).toEqual(event);
    expect(
      usageEventSchema.safeParse({
        ...event,
        props: { attempts: [], barcode: '3017620422003' },
      }).success,
    ).toBe(false);
    expect(
      usageEventSchema.safeParse({
        ...event,
        props: { attempts: [{ provider: 'openfoodfacts', result: 'slow' }] },
      }).success,
    ).toBe(false);
  });
});

describe('the lookup time limits (regression: #74)', () => {
  it('#66-4: the app waits longer than the server can be set to take, so a configured time is never cut short by the client', () => {
    expect(LOOKUP_CLIENT_TIMEOUT_MS).toBeGreaterThan(MAX_LOOKUP_TIMEOUT_MS);
  });
});
