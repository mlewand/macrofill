import type { Page } from '@playwright/test';
import { MOCK_SCANNER_KEY, type MockScannerWindow } from '../src/scanner';

// Playwright has no camera: e2e runs the production bundle with the mock scanner switched on before
// the page loads, and "reads" codes through the page's handle on it.

export async function useMockScanner(page: Page) {
  await page.addInitScript((key) => localStorage.setItem(key, '1'), MOCK_SCANNER_KEY);
}

/** The camera reads `code`, if the scan view is open. */
export async function scan(page: Page, code: string) {
  await page.evaluate(
    (c) => (window as unknown as MockScannerWindow).macrofillScanner!.scan(c),
    code,
  );
}

/** A valid EAN-13 from 12 digits, so every run can use a barcode the store has never seen. */
export function ean13(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return `${first12}${(10 - (sum % 10)) % 10}`;
}
