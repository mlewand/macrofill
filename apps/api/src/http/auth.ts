import { loginRequestSchema } from '@macrofill/domain';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { hashPassword, verifyPassword } from '../auth/password';
import { newSessionToken, SESSION_COOKIE, SESSION_TTL_MS, sessionId } from '../auth/sessions';
import type { Db } from '../db/client';
import { createAuthRepository } from '../repositories/auth';
import { jsonBody } from './validation';

export interface AuthEnv {
  Variables: { userId: string };
}

/** M4-2: resolves the session cookie to the current user; anything else gets 401. */
export function sessionAuth(db: Db, now: () => Date) {
  const auth = createAuthRepository(db);
  return createMiddleware<AuthEnv>(async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const userId =
      token === undefined ? undefined : await auth.sessionOwner(sessionId(token), now());
    if (userId === undefined) return c.json({ error: 'unauthorized' as const }, 401);
    c.set('userId', userId);
    await next();
  });
}

// Verified when the username is unknown, so both failures take as long (M4-1).
let dummyHash: Promise<string> | undefined;

/** M4-1: `POST /login`. Outside `sessionAuth`, like health. */
export function loginRoutes(db: Db, now: () => Date) {
  const auth = createAuthRepository(db);
  return new Hono().post('/login', jsonBody(loginRequestSchema), async (c) => {
    const { username, password } = c.req.valid('json');
    const user = await auth.userByUsername(username);
    const hash = user?.passwordHash ?? (await (dummyHash ??= hashPassword(newSessionToken())));
    const valid = await verifyPassword(password, hash);
    // Same answer for an unknown user, a user without a password and a wrong password.
    if (user?.passwordHash == null || !valid) {
      return c.json({ error: 'invalid_credentials' as const }, 401);
    }
    const token = newSessionToken();
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS);
    await auth.createSession({ id: sessionId(token), ownerId: user.id, createdAt, expiresAt });
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      expires: expiresAt,
    });
    return c.body(null, 204);
  });
}
