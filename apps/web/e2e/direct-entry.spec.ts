import { expect, test } from '@playwright/test';
import en from '../src/i18n/en.json' with { type: 'json' };

// Runs against the production build and a seeded database. It adds a meal on every run, so
// assertions don't depend on what's already there.
test('M5-1 to M5-6: log a meal with Direct Entry, with skip, undo and a summary edit', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: en.home.logMeal }).click();
  await page.getByRole('button', { name: 'Curd' }).click();

  const grams = page.getByLabel(en.step.grams);
  const next = page.getByRole('button', { name: en.step.next });

  // Step 1, curd: the default product is preselected.
  await expect(page.getByText('Step 1 of 5')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Polmlek Twaróg półtłusty' })).toBeChecked();
  await grams.fill('-3');
  await next.click();
  await expect(page.getByRole('alert')).toHaveText(en.step.problem.negative);
  await grams.fill('200');
  await next.click();

  // Step 2, milk: go back, and the curd's grams are restored (M5-5).
  await expect(page.getByText('Step 2 of 5')).toBeVisible();
  await page.getByRole('button', { name: en.step.undo }).click();
  await expect(grams).toHaveValue('200');
  await next.click();
  await grams.fill('50,5');
  await next.click();

  // Step 3, cucumber: skipped (M5-4). Steps 4 and 5: ham and radish.
  await page.getByRole('button', { name: en.step.skip }).click();
  await grams.fill('30');
  await next.click();
  await grams.fill('20');
  await next.click();

  // Summary (M5-6): edit the curd, then save.
  await expect(page.getByRole('heading', { name: en.summary.title })).toBeVisible();
  await expect(page.getByText(en.summary.skipped)).toBeVisible();
  await page.getByRole('textbox', { name: 'Grams of Polmlek Twaróg półtłusty' }).fill('180');
  // 180 g curd (17) + 50.5 g milk (3.0) + 30 g ham (16) + 20 g radish (1.0) = 37.1 g protein.
  await expect(page.getByRole('row', { name: /Protein/ })).toContainText('37.1 g');
  // No seed product has fibre: unknown, never 0 (M2-3).
  await expect(page.getByRole('row', { name: /Fibre/ })).toContainText(en.unknown);

  await page.getByRole('button', { name: en.summary.save }).click();
  await expect(page.getByRole('status')).toHaveText(en.saved.title);
});
