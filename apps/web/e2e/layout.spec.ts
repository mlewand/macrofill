import { expect, test, type Page } from '@playwright/test';
import en from '../src/i18n/en.json' with { type: 'json' };

/**
 * M7-6 on the current screen: every primary action button spans the full width of its column and
 * is at least 64 px tall, and nothing overflows sideways in portrait.
 */
async function checkLayout(page: Page, screen: string) {
  const buttons = page.locator('button.primary');
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
  await expect(page.getByRole('status')).toHaveText(en.saved.title);
  await checkLayout(page, 'saved');
});
