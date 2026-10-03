import { describe, expect, it } from 'vitest';
import { createLookupProviders } from '../src/lookup/providers';
import { testLookupConfig } from './support/db';

describe('the providers the app asks', () => {
  it('#67-1: Open Food Facts is asked first, then USDA FoodData Central', () => {
    const providers = createLookupProviders({ ...testLookupConfig, usdaApiKey: 'key' });
    expect(providers.map((p) => p.id)).toEqual(['openfoodfacts', 'usda-fdc']);
  });

  it('#67-5: with no USDA API key that provider is left out, and the app works with Open Food Facts alone', () => {
    expect(createLookupProviders(testLookupConfig).map((p) => p.id)).toEqual(['openfoodfacts']);
  });
});
