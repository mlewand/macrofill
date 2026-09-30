import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const port = 4173;
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
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],
  webServer: {
    // Build, reset the e2e database (create if missing, migrate, seed), then serve.
    command: 'pnpm build && pnpm --filter @macrofill/api e2e:db && node apps/api/dist/server.mjs',
    cwd: repoRoot,
    url: `http://localhost:${port}/`,
    env: {
      API_PORT: String(port),
      WEB_DIST: fileURLToPath(new URL('dist', import.meta.url)),
      DATABASE_URL: e2eDatabaseUrl(),
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
