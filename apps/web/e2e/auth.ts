import { expect, type Page } from '@playwright/test';
import en from '../src/i18n/en.json' with { type: 'json' };

/** The seed user's password in the e2e database; playwright.config.ts passes it to the seed. */
export const E2E_USERNAME = 'mlewand';
export const E2E_PASSWORD = 'e2e-password';

/** Where the setup project keeps the logged-in session for the other tests. */
export const STORAGE_STATE = 'e2e/.auth/session.json';

/** Logs in through the form the app shows while there's no session. */
export async function logIn(page: Page, password = E2E_PASSWORD) {
  const dialog = page.getByRole('dialog', { name: en.login.title });
  await dialog.getByLabel(en.login.username).fill(E2E_USERNAME);
  await dialog.getByLabel(en.login.password).fill(password);
  await dialog.getByRole('button', { name: en.login.submit }).click();
  return dialog;
}

export async function expectLoggedIn(page: Page) {
  await expect(page.getByRole('dialog', { name: en.login.title })).toBeHidden();
  await expect(page.getByRole('heading', { name: en.today.title })).toBeVisible();
}
