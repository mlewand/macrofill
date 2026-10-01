import { expect, test, type Page } from '@playwright/test';
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
  // Each step's grams input is focused, ready to type into (M5-3).
  await expect(grams).toBeFocused();
  await expect(page.getByRole('radio', { name: 'Polmlek Twaróg półtłusty' })).toBeChecked();
  await grams.fill('-3');
  await next.click();
  await expect(page.getByRole('alert')).toHaveText(en.step.problem.negative);
  await grams.fill('200');
  await next.click();

  // Step 2, milk: go back, and the curd's grams are restored (M5-5).
  await expect(page.getByText('Step 2 of 5')).toBeVisible();
  await expect(grams).toBeFocused();
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

test('M5-8: a page reload resumes Direct Entry at the same step, with what was entered', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: en.home.logMeal }).click();
  await page.getByRole('button', { name: 'Curd' }).click();
  const grams = page.getByLabel(en.step.grams);
  await grams.fill('200');
  await page.getByRole('button', { name: en.step.next }).click();
  await expect(page.getByText('Step 2 of 5')).toBeVisible();
  await grams.fill('50,5');
  // Kept once IndexedDB has it; a reload within milliseconds of typing may lose the last change.
  await expect
    .poll(async () => {
      const draft = (await keptDraft(page)) as {
        state: { current: number; steps: { grams: string }[] };
      };
      return [draft?.state.current, draft?.state.steps[1]?.grams];
    })
    .toEqual([1, '50,5']);

  await page.reload();
  await expect(page.getByText('Step 2 of 5')).toBeVisible();
  await expect(grams).toHaveValue('50,5');
  await page.getByRole('button', { name: en.step.undo }).click();
  await expect(grams).toHaveValue('200');

  // Discarding ends it: the next reload starts at home.
  await page.getByRole('button', { name: en.step.discard }).click();
  await page.getByRole('button', { name: en.step.confirmDiscard, exact: true }).click();
  await expect(page.getByRole('button', { name: en.home.logMeal })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: en.home.logMeal })).toBeVisible();
  await expect(page.getByText(/Step \d of/)).toHaveCount(0);
});

/** The Direct Entry session the page keeps in IndexedDB (M5-8). */
function keptDraft(page: Page): Promise<unknown> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('macrofill');
        open.onerror = () => reject(open.error ?? new Error('open failed'));
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('drafts')) return resolve(undefined);
          const get = db.transaction('drafts').objectStore('drafts').get('directEntry');
          get.onsuccess = () => {
            resolve(get.result);
            db.close();
          };
          get.onerror = () => reject(get.error ?? new Error('get failed'));
        };
      }),
  );
}

test('M5-9: a meal saved offline waits on the device, survives a restart and is sent once online', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: en.home.logMeal }).click();
  await page.getByRole('button', { name: 'Curd' }).click();
  const grams = page.getByLabel(en.step.grams);
  await grams.fill('123');
  await page.getByRole('button', { name: en.step.next }).click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: en.step.skip }).click();

  // The reload below must come from the service worker: wait until it controls the page.
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await context.setOffline(true);
  await page.getByRole('button', { name: en.summary.save }).click();
  await expect(page.getByText(en.saved.pending)).toBeVisible();
  await page.getByRole('button', { name: en.saved.done }).click();
  // Offline, the day can't load, but the meal waiting on the device shows.
  await expect(page.getByText(en.today.pendingTitle)).toBeVisible();

  // Closing and opening the app: the service worker serves it offline; the meal is still there.
  await page.reload();
  await expect(page.getByText(en.today.pending)).toBeVisible();

  // Back online: sent, and in Today like any other meal.
  await context.setOffline(false);
  await expect(page.getByText(en.today.pending)).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole('region', { name: en.today.title }).getByRole('table')).toBeVisible();
});
