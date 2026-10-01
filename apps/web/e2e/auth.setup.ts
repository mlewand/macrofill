import { test as setup } from '@playwright/test';
import { expectLoggedIn, logIn, STORAGE_STATE } from './auth';

// M4-1: logs in once through the form; the other tests start with this session.
setup('log in', async ({ page }) => {
  await page.goto('/');
  await logIn(page);
  await expectLoggedIn(page);
  await page.context().storageState({ path: STORAGE_STATE });
});
