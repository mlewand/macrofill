import { fileURLToPath } from 'node:url';
import { MAX_LOOKUP_TIMEOUT_MS } from '@macrofill/domain';
import { z } from 'zod';

/** An unset variable and an empty one (`FOO=` in a .env file) both mean "use the default". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

const envSchema = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  MIGRATIONS_DIR: z.string().min(1).optional(),
  WEB_DIST: z.string().min(1).optional(),
  /** #66-4: how long one product database may take before the lookup goes on without it. */
  LOOKUP_TIMEOUT_MS: optional(
    z.coerce.number().int().min(1).max(MAX_LOOKUP_TIMEOUT_MS).default(5000),
  ),
  /**
   * #67-2: how long the whole lookup may take, all product databases together. Capped like the
   * per-provider time, so the app, which waits longer than the cap, never gives up first.
   */
  LOOKUP_TOTAL_TIMEOUT_MS: optional(
    z.coerce.number().int().min(1).max(MAX_LOOKUP_TIMEOUT_MS).default(10_000),
  ),
  /** USDA FoodData Central's data.gov key (#67-5): without one that provider is left out. */
  USDA_API_KEY: optional(z.string().min(1).max(200).optional()),
  USDA_API_URL: optional(z.url().default('https://api.nal.usda.gov')),
  /** Open Food Facts; tests and e2e point it at a stub, so CI never calls the real one. */
  OPEN_FOOD_FACTS_URL: optional(z.url().default('https://world.openfoodfacts.org')),
  /** The build's version and a contact, for the User-Agent that Open Food Facts asks for. */
  APP_VERSION: optional(z.string().min(1).max(64).default('dev')),
  LOOKUP_CONTACT: optional(z.string().min(1).max(200).default('macrofill_app@mlewandowski.com')),
});

export interface Config {
  port: number;
  databaseUrl: string;
  /** Drizzle migrations. Defaults to `apps/api/drizzle`; the production image sets its own. */
  migrationsDir: string;
  /** Built `apps/web` to serve (production). Unset in development, where Vite serves it. */
  webDist?: string;
  /** Looking an unknown barcode up in public product databases (#66). */
  lookup: {
    /** Per provider. */
    timeoutMs: number;
    /** All providers together. */
    totalTimeoutMs: number;
    openFoodFactsUrl: string;
    usdaUrl: string;
    /** Unset: USDA FoodData Central isn't asked. */
    usdaApiKey?: string;
    userAgent: string;
  };
}

const defaultMigrationsDir = fileURLToPath(new URL('../drizzle', import.meta.url));

export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    // Paths and messages only: values like DATABASE_URL hold secrets.
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${issues.join('\n')}`);
  }
  const {
    API_PORT,
    DATABASE_URL,
    MIGRATIONS_DIR,
    WEB_DIST,
    LOOKUP_TIMEOUT_MS,
    LOOKUP_TOTAL_TIMEOUT_MS,
    USDA_API_KEY,
    USDA_API_URL,
    OPEN_FOOD_FACTS_URL,
    APP_VERSION,
    LOOKUP_CONTACT,
  } = result.data;
  return {
    port: API_PORT,
    databaseUrl: DATABASE_URL,
    migrationsDir: MIGRATIONS_DIR ?? defaultMigrationsDir,
    ...(WEB_DIST === undefined ? {} : { webDist: WEB_DIST }),
    lookup: {
      timeoutMs: LOOKUP_TIMEOUT_MS,
      totalTimeoutMs: LOOKUP_TOTAL_TIMEOUT_MS,
      openFoodFactsUrl: OPEN_FOOD_FACTS_URL,
      usdaUrl: USDA_API_URL,
      ...(USDA_API_KEY === undefined ? {} : { usdaApiKey: USDA_API_KEY }),
      userAgent: `Macrofill/${APP_VERSION} (${LOOKUP_CONTACT})`,
    },
  };
}
