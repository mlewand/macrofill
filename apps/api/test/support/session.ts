import type { createApp } from '../../src/app';
import { hashPassword } from '../../src/auth/password';
import type { Db } from '../../src/db/client';
import { createAuthRepository } from '../../src/repositories/auth';
import { seedData } from '../../src/seed/data';

export const TEST_PASSWORD = 'correct horse battery staple';
export const seedUsername = seedData.users[0]!.user.username;

type App = ReturnType<typeof createApp>;
/** The app as a signed-in user sees it: every request carries the session cookie. */
export type TestApp = Pick<App, 'request' | 'routes'>;

// Hashing takes a while (on purpose), so tests share one hash.
let testHash: Promise<string> | undefined;

/** Gives `username` the test password, logs in and returns the `Cookie` header value. */
export async function logIn(app: App, db: Db, username = seedUsername): Promise<string> {
  await createAuthRepository(db).setPasswordHash(
    username,
    await (testHash ??= hashPassword(TEST_PASSWORD)),
  );
  const res = await app.request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: TEST_PASSWORD }),
  });
  const cookie = res.headers.get('set-cookie');
  if (res.status !== 204 || cookie === null) throw new Error(`login failed: ${res.status}`);
  return cookie.split(';', 1)[0]!;
}

/** `app` with `cookie` on every request. */
export function withCookie(app: App, cookie: string): TestApp {
  return {
    routes: app.routes,
    request: (input, init, ...rest) => {
      const headers = new Headers(init?.headers);
      headers.set('Cookie', cookie);
      return app.request(input, { ...init, headers }, ...rest);
    },
  };
}

/** `app`, logged in as `username`. */
export async function signedIn(app: App, db: Db, username = seedUsername): Promise<TestApp> {
  return withCookie(app, await logIn(app, db, username));
}
