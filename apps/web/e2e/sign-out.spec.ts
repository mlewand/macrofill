import { expect, test } from '@playwright/test';
import en from '../src/i18n/en.json' with { type: 'json' };
import { expectLoggedIn, logIn } from './auth';

// #95: its own login, not the setup project's: signing out ends a session on the server, and the
// other tests share that one.
test.use({ storageState: { cookies: [], origins: [] } });

test('#95-1, #95-2, #95-3: signing out ends the session, and the old cookie stops working', async ({
  page,
}) => {
  await page.goto('/');
  await logIn(page);
  await expectLoggedIn(page);
  const [session] = await page.context().cookies();
  expect(session).toBeDefined();
  const cookie = `${session!.name}=${session!.value}`;
  const me = () => page.request.get('/api/me', { headers: { cookie } });
  expect((await me()).status()).toBe(200);

  await page.getByRole('button', { name: en.signOut.button }).click();
  // The form replaces the app, which stays hidden under it: no meals or targets in sight.
  await expect(page.getByRole('dialog', { name: en.login.title })).toBeVisible();
  await expect(page.getByRole('button', { name: en.home.weighMeal })).toBeHidden();
  await expect(page.getByRole('heading', { name: en.today.title })).toBeHidden();
  // Ended on the server, not just forgotten by the browser.
  expect((await me()).status()).toBe(401);

  // A reload asks again, and logging in works as before.
  await page.reload();
  await expect(page.getByRole('dialog', { name: en.login.title })).toBeVisible();
  await logIn(page);
  await expectLoggedIn(page);
});
