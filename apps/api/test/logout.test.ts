import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { SESSION_COOKIE } from '../src/auth/sessions';
import { queryRows, type Database } from '../src/db/client';
import { seed } from '../src/seed/seed';
import { createMigratedTestDatabase } from './support/db';
import { logIn, withCookie } from './support/session';

// #95-2: POST /api/logout ends the session it is called with.

const NOW = new Date('2026-01-15T11:00:00.000Z');

describe('POST /api/logout (#95)', () => {
  let database: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    database = await createMigratedTestDatabase();
    await seed(database.db);
    app = createApp({ db: database.db, now: () => NOW });
  });

  afterEach(async () => {
    await database.close();
  });

  const logout = (cookie?: string) =>
    app.request('/api/logout', {
      method: 'POST',
      ...(cookie === undefined ? {} : { headers: { Cookie: cookie } }),
    });

  const sessionCount = async () => {
    const [row] = await queryRows<{ n: number }>(
      database.db,
      sql`select count(*)::int as n from sessions`,
    );
    return row!.n;
  };

  it('#95-2: deletes the session on the server and clears the cookie, with a 204', async () => {
    const cookie = await logIn(app, database.db);
    expect(await sessionCount()).toBe(1);
    const res = await logout(cookie);
    expect(res.status).toBe(204);
    const cleared = res.headers.get('set-cookie') ?? '';
    expect(cleared).toMatch(new RegExp(`^${SESSION_COOKIE}=;`));
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('Path=/');
    expect(await sessionCount()).toBe(0);
  });

  it('#95-2: the old token stops working at once, long before it would have expired', async () => {
    const cookie = await logIn(app, database.db);
    const authed = withCookie(app, cookie);
    expect((await authed.request('/api/today')).status).toBe(200);
    await logout(cookie);
    expect((await authed.request('/api/today')).status).toBe(401);
    expect((await authed.request('/api/me')).status).toBe(401);
  });

  it('#95-2: answers 204 without a session, and with a token the server does not know', async () => {
    expect((await logout()).status).toBe(204);
    const unknown = await logout(`${SESSION_COOKIE}=${'A'.repeat(43)}`);
    expect(unknown.status).toBe(204);
    expect(unknown.headers.get('set-cookie') ?? '').toMatch(new RegExp(`^${SESSION_COOKIE}=;`));
    // Twice is fine too.
    const cookie = await logIn(app, database.db);
    expect((await logout(cookie)).status).toBe(204);
    expect((await logout(cookie)).status).toBe(204);
  });

  it("#95-2: ends only this session: the user's other devices stay signed in", async () => {
    const phone = await logIn(app, database.db);
    const tablet = await logIn(app, database.db);
    expect(phone).not.toBe(tablet);
    await logout(phone);
    expect((await withCookie(app, phone).request('/api/today')).status).toBe(401);
    expect((await withCookie(app, tablet).request('/api/today')).status).toBe(200);
    expect(await sessionCount()).toBe(1);
  });
});
