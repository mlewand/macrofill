import { expect, test } from '@playwright/test';

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
    start_url: '/',
    display: 'standalone',
    icons: expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192' }),
      expect.objectContaining({ sizes: '512x512' }),
    ]),
  });

  // Chrome's own check, the one behind the install prompt.
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
});
