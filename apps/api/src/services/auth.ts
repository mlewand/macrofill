import type { LoginRequest } from '@macrofill/domain';
import { hashPassword, verifyPassword } from '../auth/password';
import { newSessionToken, SESSION_TTL_MS, sessionId } from '../auth/sessions';
import type { Db } from '../db/client';
import { createAuthRepository } from '../repositories/auth';

// One per process, started when the first service is built.
let dummy: Promise<string> | undefined;
function dummyHash(): Promise<string> {
  if (dummy === undefined) {
    dummy = hashPassword(newSessionToken());
    // Only ever awaited on a login; don't report a failure before that.
    dummy.catch(() => undefined);
  }
  return dummy;
}

export type LoginResult = { status: 'ok'; token: string; expiresAt: Date } | { status: 'invalid' };

/**
 * M4-1: checks a username and password and opens a session. An unknown user, a user without a
 * password and a wrong password are all `invalid`, and take as long: an unknown user's password is
 * checked against a dummy hash, made when the app starts, so even the first such login isn't faster.
 */
export function createAuthService(db: Db, now: () => Date) {
  const auth = createAuthRepository(db);
  void dummyHash();

  return {
    async logIn({ username, password }: LoginRequest): Promise<LoginResult> {
      const user = await auth.userByUsername(username);
      const hash = user?.passwordHash ?? (await dummyHash());
      const valid = await verifyPassword(password, hash);
      if (user?.passwordHash == null || !valid) return { status: 'invalid' };
      const token = newSessionToken();
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS);
      await auth.createSession({ id: sessionId(token), ownerId: user.id, createdAt, expiresAt });
      return { status: 'ok', token, expiresAt };
    },

    /** The user an unexpired session belongs to, if any. */
    sessionUser(token: string): Promise<string | undefined> {
      return auth.sessionOwner(sessionId(token), now());
    },
  };
}
