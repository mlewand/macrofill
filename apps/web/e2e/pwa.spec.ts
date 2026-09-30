import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// The build the e2e server serves (WEB_DIST in playwright.config.ts).
const swPath = fileURLToPath(new URL('../dist/sw.js', import.meta.url));

test('M7-7: the manifest and service worker pass Chrome’s installability check', async ({
  page,
  context,
}) => {
  await page.goto('/');
  // The service worker registers and activates. `ready` resolves while it may still be activating.
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state))
    .toBe('activated');

  const manifest = (await (await page.request.get('/manifest.webmanifest')).json()) as Record<
    string,
    unknown
  >;
  expect(manifest).toMatchObject({
    name: 'Macrofill',
    short_name: 'Macrofill',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: '#2f6f3e',
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
    ]),
  );

  // Chrome's own check, the one behind the install prompt.
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
});

test('M7-7: a new version taking over mid-meal does not reload the page or lose the draft', async ({
  page,
}) => {
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state))
    .toBe('activated');
  // Like a returning user: the page is controlled by the installed version from the start.
  await page.reload();
  const firstVersion = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL);
  expect(firstVersion).toMatch(/\/sw\.js$/);

  // Start a meal and type some grams, all only in memory.
  await page.getByRole('button', { name: 'Log a meal' }).click();
  await page.getByRole('button', { name: 'Curd' }).click();
  await page.getByLabel('Grams').fill('123,4');
  await page.evaluate(() => {
    (window as unknown as { loadedOnce: boolean }).loadedOnce = true;
  });

  // A deploy, as the browser sees it: the served sw.js changes. Then the update is picked up.
  const original = await readFile(swPath, 'utf8');
  await writeFile(swPath, `${original}\n// next version\n`);
  try {
    const changed = page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
            once: true,
          });
        }),
    );
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update();
    });
    await changed;
  } finally {
    await writeFile(swPath, original);
  }

  // The new worker controls the page, yet the page wasn't reloaded and the draft is intact.
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return {
      controlled: navigator.serviceWorker.controller !== null,
      waiting: r?.waiting !== null,
    };
  });
  expect(reg).toEqual({ controlled: true, waiting: false });
  expect(
    await page.evaluate(() => (window as unknown as { loadedOnce?: boolean }).loadedOnce),
  ).toBe(true);
  await expect(page.getByLabel('Grams')).toHaveValue('123,4');
  await expect(page.getByText('Step 1 of 5')).toBeVisible();
});

test('M7-7: offline, the service worker serves the app for any route but never answers /api', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state))
    .toBe('activated');
  await page.reload(); // now the page is controlled by the service worker
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // Online, /api goes to the server, not to the app shell.
  const health = await page.goto('/api/health');
  expect(await health?.json()).toEqual({ status: 'ok' });

  await context.setOffline(true);
  try {
    // A client-side route falls back to the precached app.
    await page.goto('/today');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Macrofill');
    // /api is never served from the cache or the fallback: offline, it fails.
    await expect(page.goto('/api/health')).rejects.toThrow();
  } finally {
    await context.setOffline(false);
  }
});
