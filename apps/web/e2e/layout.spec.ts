import { scaleScript } from '@macrofill/scale';
import { expect, test, type Page } from '@playwright/test';
import en from '../src/i18n/en.json' with { type: 'json' };
import { play, useMockScale } from './scale';

/**
 * M7-6 on the current screen: every primary action button spans the full width of its column and
 * is at least 64 px tall, and nothing overflows sideways in portrait.
 */
async function checkLayout(page: Page, screen: string) {
  // Visible ones: under the login form, the app's buttons are hidden.
  const buttons = page.locator('button.primary:visible');
  const count = await buttons.count();
  expect(count, `${screen}: primary buttons`).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const size = await buttons.nth(i).evaluate((button) => {
      const box = button.getBoundingClientRect();
      const column = button.parentElement!.getBoundingClientRect();
      return { width: box.width, height: box.height, column: column.width };
    });
    expect(size.height, `${screen}: button ${i} height`).toBeGreaterThanOrEqual(64);
    expect(size.width, `${screen}: button ${i} width`).toBeCloseTo(size.column, 0);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${screen}: horizontal overflow`).toBeLessThanOrEqual(0);
}

test('M7-6: every screen works in portrait, with full-width primary buttons at least 64 px tall', async ({
  page,
}) => {
  const viewport = page.viewportSize()!;
  expect(viewport.height, 'portrait').toBeGreaterThan(viewport.width);

  await page.goto('/');
  await expect(page.getByRole('region', { name: en.today.title }).getByRole('table')).toBeVisible();
  await checkLayout(page, 'home');

  await page.getByRole('button', { name: en.home.logMeal }).click();
  await expect(page.getByRole('button', { name: 'Curd' })).toBeVisible();
  await checkLayout(page, 'recipes');

  await page.getByRole('button', { name: 'Curd' }).click();
  await expect(page.getByText('Step 1 of 5')).toBeVisible();
  await checkLayout(page, 'step');

  await page.getByLabel(en.step.grams).fill('100');
  await page.getByRole('button', { name: en.step.next }).click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: en.step.skip }).click();
  await expect(page.getByRole('heading', { name: en.summary.title })).toBeVisible();
  await checkLayout(page, 'summary');

  await page.getByRole('button', { name: en.summary.save }).click();
  await expect(page.getByText(en.saved.title)).toBeVisible();
  await checkLayout(page, 'saved');
});

test.describe('logged out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('M7-6: the login screen works in portrait, with a full-width button at least 64 px tall', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog', { name: en.login.title })).toBeVisible();
    await checkLayout(page, 'login');
  });
});

test('M7-6: Scale Mode works in portrait, and the live weight is at least 48 px', async ({
  page,
}) => {
  await useMockScale(page);
  const script = scaleScript({ intervalMs: 50 });
  await page.goto('/');
  await page.getByRole('button', { name: en.home.weighMeal }).click();
  await page.getByRole('button', { name: 'Curd' }).click();
  await checkLayout(page, 'connect');

  await page.getByRole('button', { name: en.scale.connect }).click();
  await play(page, script.baseline(312, { forMs: 0 }).take());
  await expect(page.getByRole('button', { name: en.scale.start })).toBeEnabled();
  await checkLayout(page, 'start');

  await page.getByRole('button', { name: en.scale.start }).click();
  await play(page, script.add(214.5).take());
  const live = page.getByLabel(en.scale.added);
  await expect(live).toHaveText('214.5 g');
  const fontSize = await live.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize, 'live weight font size').toBeGreaterThanOrEqual(48);
  await checkLayout(page, 'scale step');
});
