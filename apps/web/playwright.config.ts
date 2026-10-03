import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { E2E_PASSWORD, STORAGE_STATE } from './e2e/auth';

const port = 4173;
/** The stand-in for Open Food Facts (e2e/offStub.js): the lookup never calls the real one. */
const offStubPort = 4174;
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * e2e gets its own database, reset before every run, so it never touches the dev data:
 * E2E_DATABASE_URL, or else DATABASE_URL with `_e2e` added to the database name
 * (`macrofill` → `macrofill_e2e`). Both come from the environment or the root .env.
 */
function e2eDatabaseUrl(): string {
  const dotEnvPath = `${repoRoot}/.env`;
  const dotEnv = existsSync(dotEnvPath) ? parseEnv(readFileSync(dotEnvPath, 'utf8')) : {};
  const env = { ...dotEnv, ...process.env };
  if (env.E2E_DATABASE_URL) return env.E2E_DATABASE_URL;
  if (!env.DATABASE_URL) {
    throw new Error(
      'e2e needs DATABASE_URL or E2E_DATABASE_URL, in the environment or the root .env.',
    );
  }
  const url = new URL(env.DATABASE_URL);
  url.pathname = `${url.pathname}_e2e`;
  return url.toString();
}

// e2e runs against the production build served by the api, like the deployed image.
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  // The tests share one database and some add meals, so they run one at a time.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  // M7-6: everything runs on a phone and a tablet, both in portrait, logged in by `setup` (M4-1).
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { ...devices['Pixel 7'] } },
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
    {
      name: 'tablet',
      use: { ...devices['Galaxy Tab S4'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
  ],
  webServer: [
    {
      command: 'node apps/web/e2e/offStub.js',
      cwd: repoRoot,
      url: `http://127.0.0.1:${offStubPort}/ping`,
      env: { OFF_STUB_PORT: String(offStubPort) },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // Build, reset the e2e database (create if missing, migrate, seed), then serve.
      command: 'pnpm build && pnpm --filter @macrofill/api e2e:db && node apps/api/dist/server.mjs',
      cwd: repoRoot,
      url: `http://localhost:${port}/`,
      env: {
        API_PORT: String(port),
        WEB_DIST: fileURLToPath(new URL('dist', import.meta.url)),
        DATABASE_URL: e2eDatabaseUrl(),
        // The reset loads the root .env and the server doesn't; pin the migrations so both use the
        // repo's, whatever .env or the shell says (e.g. the production image's /app/drizzle).
        MIGRATIONS_DIR: `${repoRoot}/apps/api/drizzle`,
        // The seed user's initial password (M4-1), for logging in.
        SEED_PASSWORD_MLEWAND: E2E_PASSWORD,
        // #66: the lookup of an unknown barcode asks the stub, not the real Open Food Facts.
        OPEN_FOOD_FACTS_URL: `http://127.0.0.1:${offStubPort}`,
      },
      // Never reuse a running server: the reset above must run every time, and a stale server could
      // even be connected to the dev database. A busy port fails the run instead.
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
