import { expect, test } from '@playwright/test';
import en from '../src/i18n/en.json' with { type: 'json' };
import { expectLoggedIn, logIn } from './auth';

// Without the setup project's session.
test.use({ storageState: { cookies: [], origins: [] } });

test('M4-1, M4-2: the app asks to log in, refuses a wrong password and accepts the right one', async ({
  page,
}) => {
  await page.goto('/');
  // The form replaces the app, which stays hidden (and mounted) under it.
  await expect(page.getByRole('dialog', { name: en.login.title })).toBeVisible();
  await expect(page.getByRole('button', { name: en.home.weighMeal })).toBeHidden();
  const dialog = await logIn(page, 'wrong password');
  await expect(dialog.getByRole('alert')).toHaveText(en.login.invalid);
  await logIn(page);
  await expectLoggedIn(page);

  // M4-1: the session cookie is HttpOnly, Secure and SameSite=Lax.
  const [cookie] = await page.context().cookies();
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });

  // It lasts across a reload.
  await page.reload();
  await expectLoggedIn(page);
});
