import { loginRequestSchema } from '@macrofill/domain';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { SESSION_COOKIE } from '../auth/sessions';
import type { Db } from '../db/client';
import { createAuthService } from '../services/auth';
import { jsonBody } from './validation';

export interface AuthEnv {
  Variables: { userId: string };
}

/** M4-2: resolves the session cookie to the current user; anything else gets 401. */
export function sessionAuth(db: Db, now: () => Date) {
  const auth = createAuthService(db, now);
  return createMiddleware<AuthEnv>(async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const userId = token === undefined ? undefined : await auth.sessionUser(token);
    if (userId === undefined) return c.json({ error: 'unauthorized' as const }, 401);
    c.set('userId', userId);
    await next();
  });
}

/**
 * M4-1: `POST /login`, and #95-2: `POST /logout`. Outside `sessionAuth`, like health: logging out
 * answers 204 whether or not there is a session to end.
 */
export function loginRoutes(db: Db, now: () => Date) {
  const auth = createAuthService(db, now);
  return new Hono()
    .post('/login', jsonBody(loginRequestSchema), async (c) => {
      const result = await auth.logIn(c.req.valid('json'));
      if (result.status === 'invalid')
        return c.json({ error: 'invalid_credentials' as const }, 401);
      setCookie(c, SESSION_COOKIE, result.token, {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        path: '/',
        expires: result.expiresAt,
      });
      return c.body(null, 204);
    })
    .post('/logout', async (c) => {
      const token = getCookie(c, SESSION_COOKIE);
      if (token !== undefined) await auth.logOut(token);
      deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
      return c.body(null, 204);
    });
}
