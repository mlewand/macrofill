import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'macrofill_session';

/** How long a login lasts. There's no renewal; after this, log in again. A logout (#95) ends one early. */
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** A new session token for the cookie: 256 random bits. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The stored session id for a token. */
export function sessionId(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
