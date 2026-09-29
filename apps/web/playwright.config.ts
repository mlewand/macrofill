import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const port = 4173;
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

// e2e runs against the production build served by the api, like the deployed image.
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'pnpm build && node apps/api/dist/server.mjs',
    cwd: repoRoot,
    url: `http://localhost:${port}/`,
    env: {
      API_PORT: String(port),
      WEB_DIST: fileURLToPath(new URL('dist', import.meta.url)),
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
