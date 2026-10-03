import type { Config } from '../config';
import { createOpenFoodFactsProvider } from './openFoodFacts';
import type { ProductLookupProvider } from './provider';

/** The providers the app asks, in order. Adding one is a line here and an implementation. */
export function createLookupProviders(config: Config['lookup']): ProductLookupProvider[] {
  return [
    createOpenFoodFactsProvider({
      baseUrl: config.openFoodFactsUrl,
      userAgent: config.userAgent,
      timeoutMs: config.timeoutMs,
    }),
  ];
}
