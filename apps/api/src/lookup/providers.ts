import type { Config } from '../config';
import { createOpenFoodFactsProvider } from './openFoodFacts';
import { createUsdaProvider } from './usda';
import type { ProductLookupProvider } from './provider';

/** The providers the app asks, in order. Adding one is a line here and an implementation. */
export function createLookupProviders(config: Config['lookup']): ProductLookupProvider[] {
  return [
    // #67-1: Open Food Facts first, then the others in this order.
    createOpenFoodFactsProvider({
      baseUrl: config.openFoodFactsUrl,
      userAgent: config.userAgent,
      timeoutMs: config.timeoutMs,
    }),
    // #67-5: without a key it isn't asked, and the app works as it did.
    ...(config.usdaApiKey === undefined
      ? []
      : [
          createUsdaProvider({
            baseUrl: config.usdaUrl,
            apiKey: config.usdaApiKey,
            timeoutMs: config.timeoutMs,
          }),
        ]),
  ];
}
