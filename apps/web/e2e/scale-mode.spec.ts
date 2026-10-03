import type { SaveMealRequest } from '@macrofill/domain';
import { scaleScript } from '@macrofill/scale';
import { expect, test, type Page } from '@playwright/test';
import en from '../src/i18n/en.json' with { type: 'json' };
import { comeBack, drop, play, useMockScale } from './scale';

// M6-8: Scale Mode end to end, against the production build with MockScaleDriver. Each test adds
// a meal, so assertions don't depend on what's already there. Reconnect is Phase C.

test.beforeEach(async ({ page }) => {
  await useMockScale(page);
});

/** Home → Weigh a meal → Curd → Connect scale → bowl on → Start. */
async function startCurd(page: Page) {
  const script = scaleScript({ intervalMs: 50 });
  await page.goto('/');
  await page.getByRole('button', { name: en.home.weighMeal }).click();
  await page.getByRole('button', { name: 'Curd' }).click();
  await page.getByRole('button', { name: en.scale.connect }).click();
  await expect(page.getByText(en.scale.status.connected, { exact: true })).toBeVisible();
  const start = page.getByRole('button', { name: en.scale.start });
  await expect(start).toBeDisabled();
  await play(page, script.baseline(312, { forMs: 0 }).take());
  await start.click();
  await expect(page.getByText('Step 1 of 5')).toBeVisible();
  return script;
}

const next = (page: Page) => page.getByRole('button', { name: en.step.next });
const liveWeight = (page: Page) => page.getByLabel(en.scale.added);

test('M6-8: a full meal with skip, undo, a manual correction and a negative step', async ({
  page,
}) => {
  const script = await startCurd(page);

  // Step 1, curd, poured in over a second: the step amount is live, then recorded (M6-3, M6-4).
  await play(page, script.add(200, { overMs: 1000 }).stable({ forMs: 0 }).take());
  await expect(liveWeight(page)).toHaveText('200 g');
  await expect(page.getByText('On the scale: 512 g')).toBeVisible();
  await next(page).click();
  await expect(page.getByText('Step 2 of 5')).toBeVisible();
  await expect(page.getByText('Polmlek Twaróg półtłusty: 200 g recorded')).toBeVisible();

  // Step 2, milk. Step 3, cucumber: skipped, undone, skipped again.
  await play(page, script.add(50.5).stable({ forMs: 0 }).take());
  await next(page).click();
  await page.getByRole('button', { name: en.step.skip }).click();
  await expect(page.getByText('Step 4 of 5')).toBeVisible();
  await page.getByRole('button', { name: en.step.undo }).click();
  await expect(page.getByText('Step 3 of 5')).toBeVisible();
  await page.getByRole('button', { name: en.step.skip }).click();

  // Step 4, ham, after a tare: the step would be negative, so it's typed in (M3-6).
  await play(page, script.tare().add(30).stable({ forMs: 0 }).take());
  await next(page).click();
  await expect(page.getByRole('alert')).toHaveText(en.scale.negative);
  await page.getByLabel(en.step.grams).fill('30');
  await page.getByRole('button', { name: en.scale.useGrams }).click();

  // Step 5, radish: weighed, then corrected by hand (M6-5).
  await expect(page.getByText('Step 5 of 5')).toBeVisible();
  await play(page, script.add(20).stable({ forMs: 0 }).take());
  await expect(liveWeight(page)).toHaveText('20 g');
  await page.getByRole('button', { name: en.scale.enterManually }).click();
  await page.getByLabel(en.step.grams).fill('25');
  await page.getByRole('button', { name: en.scale.useGrams }).click();

  // Summary, then save.
  await expect(page.getByRole('heading', { name: en.summary.title })).toBeVisible();
  await expect(page.getByText(en.summary.skipped)).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Grams of Polmlek Twaróg półtłusty' }),
  ).toHaveValue('200');
  const sent = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/meals'),
  );
  await page.getByRole('button', { name: en.summary.save }).click();
  await expect(page.getByText(en.saved.title)).toBeVisible();

  // M6-7, M4-7: the meal's recording was saved with it, and downloads as sent.
  const body = (await sent).postDataJSON() as SaveMealRequest;
  expect(body.recording?.events.map((e) => e.type)).toContain('correct');
  const recording = await page.request.get(`/api/meals/${body.meal.id}/recording`);
  expect(recording.status()).toBe(200);
  expect(await recording.json()).toEqual(body.recording);
});

test('M6-8, M3-4: an unstable reading at Next is proposed, and confirmed', async ({ page }) => {
  const script = await startCurd(page);
  await play(page, script.add(150).take());
  await next(page).click();
  await expect(page.getByRole('status')).toHaveText(en.scale.waiting);
  // The scale keeps moving past the 1.5 s wait.
  await play(page, script.unstable({ forMs: 2000 }).take());
  await expect(page.getByRole('status')).toHaveText(en.scale.unstable.replace('{{grams}}', '150'));
  await page.getByRole('button', { name: en.scale.confirm }).click();
  await expect(page.getByText('Polmlek Twaróg półtłusty: 150 g recorded')).toBeVisible();
});

test('M6-8, M6-10: with the scale in another unit, Start and Next are off until it shows grams', async ({
  page,
}) => {
  const script = scaleScript({ intervalMs: 50 });
  await page.goto('/');
  await page.getByRole('button', { name: en.home.weighMeal }).click();
  await page.getByRole('button', { name: 'Curd' }).click();
  await page.getByRole('button', { name: en.scale.connect }).click();
  await play(page, script.baseline(312, { forMs: 0 }).wrongUnit({ forMs: 0 }).take());
  await expect(page.getByRole('alert')).toHaveText(en.scale.wrongUnit);
  await expect(page.getByRole('button', { name: en.scale.start })).toBeDisabled();
  await play(page, script.stable({ forMs: 0 }).take());
  await page.getByRole('button', { name: en.scale.start }).click();

  await play(page, script.add(200).stable({ forMs: 0 }).wrongUnit({ forMs: 0 }).take());
  await expect(page.getByRole('alert')).toHaveText(en.scale.wrongUnit);
  await expect(next(page)).toBeDisabled();
  await play(page, script.stable({ forMs: 0 }).take());
  await expect(next(page)).toBeEnabled();
});

test('M6-8, M6-6: after the scale drops, it reconnects by itself and the meal goes on', async ({
  page,
}) => {
  const script = await startCurd(page);
  await play(page, script.add(200).stable({ forMs: 0 }).take());
  await next(page).click();
  await drop(page);
  await expect(page.getByText(en.scale.status.reconnecting, { exact: true })).toBeVisible();
  await expect(page.getByText(en.scale.reconnectingHint)).toBeVisible();
  await expect(next(page)).toBeDisabled();
  await comeBack(page);
  await expect(page.getByText(en.scale.status.connected, { exact: true })).toBeVisible();
  await expect(page.getByText('Step 2 of 5')).toBeVisible();
  for (const added of [50, 40, 30, 20]) {
    await play(page, script.add(added).stable({ forMs: 0 }).take());
    await next(page).click();
  }
  await expect(page.getByRole('heading', { name: en.summary.title })).toBeVisible();
  await page.getByRole('button', { name: en.summary.save }).click();
  await expect(page.getByText(en.saved.title)).toBeVisible();
});

test('M6-8, M6-5: after the scale drops, the meal is finished with typed grams', async ({
  page,
}) => {
  const script = await startCurd(page);
  await play(page, script.add(200).stable({ forMs: 0 }).take());
  await next(page).click();
  await drop(page);
  // Not waiting for the reconnect to give up: the user stops it.
  await page.getByRole('button', { name: en.scale.finishByHand }).click();
  await expect(page.getByText(en.scale.status.dropped, { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText(en.scale.dropped);
  for (const grams of ['50', '40', '30', '20']) {
    await page.getByLabel(en.step.grams).fill(grams);
    await next(page).click();
  }
  await expect(page.getByRole('heading', { name: en.summary.title })).toBeVisible();
  await page.getByRole('button', { name: en.summary.save }).click();
  await expect(page.getByText(en.saved.title)).toBeVisible();
});

test('#89-1: the scale stays paired for the next meal (regression: #89)', async ({ page }) => {
  // Meal one: pair the scale, Start, skip every step, save, Done.
  await startCurd(page);
  for (let step = 0; step < 5; step++) {
    await page.getByRole('button', { name: en.step.skip }).click();
  }
  await page.getByRole('button', { name: en.summary.save }).click();
  await expect(page.getByText(en.saved.title)).toBeVisible();

  // Meal two: straight to the bowl prompt, with no pairing screen in between.
  await page.getByRole('button', { name: en.home.weighMeal }).click();
  await page.getByRole('button', { name: 'Curd' }).click();
  await expect(page.getByText(en.scale.placeBowl)).toBeVisible();
  await expect(page.getByRole('button', { name: en.scale.connect })).toHaveCount(0);
  await expect(page.getByText(en.scale.status.connected, { exact: true })).toBeVisible();
  await play(page, scaleScript({ intervalMs: 50 }).baseline(312, { forMs: 0 }).take());
  await expect(page.getByRole('button', { name: en.scale.start })).toBeEnabled();
});
