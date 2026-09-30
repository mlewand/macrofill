import { expect, test } from '@playwright/test';
import en from '../src/i18n/en.json' with { type: 'json' };

test('M1-2: the production build loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.app.name);
});

test('M1-5: a client-side route loads the app from the api server', async ({ page }) => {
  await page.goto('/today');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.app.name);
});
