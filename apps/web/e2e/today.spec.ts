import { devices, expect, test, type Page } from '@playwright/test';
import en from '../src/i18n/en.json' with { type: 'json' };

// Uses the shared database, so it counts entries relative to what's already there. Playwright
// runs one worker (playwright.config.ts), so no other test adds meals meanwhile.

const todayRegion = (page: Page) => page.getByRole('region', { name: en.today.title });
const entries = (page: Page) => todayRegion(page).getByRole('listitem');

async function openToday(page: Page) {
  await page.goto('/');
  await expect(todayRegion(page).getByRole('table')).toBeVisible();
  return entries(page).count();
}

test('M5-7, M7-1 to M7-5: a meal saved on the phone shows in Today, on the tablet too, and can be deleted', async ({
  page,
  browser,
}) => {
  const before = await openToday(page);

  // Log a quick Curd meal: 123.4 g curd, the rest skipped.
  await page.getByRole('button', { name: en.home.logMeal }).click();
  await page.getByRole('button', { name: 'Curd' }).click();
  await page.getByLabel(en.step.grams).fill('123,4');
  await page.getByRole('button', { name: en.step.next }).click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: en.step.skip }).click();
  await page.getByRole('button', { name: en.summary.save }).click();
  await page.getByRole('button', { name: en.saved.done }).click();

  // M5-7, M7-1: it's in Today, newest first, with its recipe name and macros.
  await expect(entries(page)).toHaveCount(before + 1);
  const newest = entries(page).first();
  await expect(newest).toContainText('Curd');
  // 123.4 g of curd at 17 g protein per 100 g.
  await expect(newest).toContainText('Protein 21 g');
  const time = await newest.locator('time').textContent();

  // M7-5: a tablet sees it after loading the page.
  const { baseURL } = test.info().project.use;
  const tablet = await browser.newContext({
    ...devices['Galaxy Tab S4'],
    ...(baseURL === undefined ? {} : { baseURL }),
  });
  const tabletPage = await tablet.newPage();
  expect(await openToday(tabletPage)).toBe(before + 1);
  await expect(entries(tabletPage).first()).toContainText('Curd');
  await expect(entries(tabletPage).first().locator('time')).toHaveText(time ?? '');
  await tablet.close();

  // M7-4: delete it, after a confirmation.
  await newest.getByRole('button', { name: `Delete Curd eaten at ${time}` }).click();
  // Names match by substring by default, and every entry has a "Delete …" button.
  await newest.getByRole('button', { name: en.today.confirm, exact: true }).click();
  await expect(entries(page)).toHaveCount(before);
});
