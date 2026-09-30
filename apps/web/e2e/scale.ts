import type { TimedReading } from '@macrofill/domain';
import type { Page } from '@playwright/test';
import { MOCK_SCALE_KEY, type MockScaleWindow } from '../src/scale';

// M6-8: e2e runs the production bundle with MockScaleDriver switched on before the page loads,
// and plays scaleScript() readings through the page's handle on it.

export async function useMockScale(page: Page) {
  await page.addInitScript((key) => localStorage.setItem(key, '1'), MOCK_SCALE_KEY);
}

/** Plays readings on the session's mock scale; resolves once they're played. */
export async function play(page: Page, readings: TimedReading[]) {
  await page.evaluate(
    (r) => (window as unknown as MockScaleWindow).macrofillScale!.play(r),
    readings,
  );
}

/** The scale goes away, e.g. auto-off. */
export async function drop(page: Page) {
  await page.evaluate(() => (window as unknown as MockScaleWindow).macrofillScale!.drop());
}
