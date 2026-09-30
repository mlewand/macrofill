import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { hashPassword } from '../src/auth/password';
import { passwordFromInput, resetPassword } from '../src/auth/reset';
import { SESSION_COOKIE, SESSION_TTL_MS } from '../src/auth/sessions';
import { queryRows, type Database } from '../src/db/client';
import { seedData } from '../src/seed/data';
import { seed, seedPasswordsFromEnv, seedPasswordVariable } from '../src/seed/seed';
import { createMigratedTestDatabase } from './support/db';
import { logIn, seedUsername, TEST_PASSWORD, withCookie } from './support/session';

const NOW = new Date('2026-01-15T11:00:00.000Z');

describe('login and sessions (M4-1, M4-2)', () => {
  let database: Database;
  let now: Date;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    database = await createMigratedTestDatabase();
    await seed(database.db);
    now = NOW;
    app = createApp({ db: database.db, now: () => now });
  });

  afterEach(async () => {
    await database.close();
  });

  const login = (body: unknown) =>
    app.request('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const passwordHash = async (username = seedUsername) => {
    const [row] = await queryRows<{ password_hash: string | null }>(
      database.db,
      sql`select password_hash from users where username = ${username}`,
    );
    return row?.password_hash;
  };

  it('M4-1: logging in sets an HttpOnly, Secure, SameSite=Lax session cookie', async () => {
    await resetPassword(database.db, seedUsername, TEST_PASSWORD);
    const res = await login({ username: seedUsername, password: TEST_PASSWORD });
    expect(res.status).toBe(204);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43};`));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain(`Expires=${new Date(NOW.getTime() + SESSION_TTL_MS).toUTCString()}`);
  });

  it('M4-1: the session opens the api to its user', async () => {
    const authed = withCookie(app, await logIn(app, database.db));
    expect((await authed.request('/api/today')).status).toBe(200);
  });

  it('M4-1: a wrong username and a wrong password get the same 401', async () => {
    await resetPassword(database.db, seedUsername, TEST_PASSWORD);
    const wrongPassword = await login({ username: seedUsername, password: 'not the password' });
    const wrongUsername = await login({ username: 'nobody', password: TEST_PASSWORD });
    expect(wrongPassword.status).toBe(401);
    expect(wrongUsername.status).toBe(401);
    expect(await wrongUsername.json()).toEqual(await wrongPassword.json());
    expect(wrongPassword.headers.get('set-cookie')).toBeNull();
    expect(wrongUsername.headers.get('set-cookie')).toBeNull();
  });

  it('M4-1: a user without a password can not log in', async () => {
    expect(await passwordHash()).toBeNull();
    const res = await login({ username: seedUsername, password: TEST_PASSWORD });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_credentials' });
  });

  it('M4-4: an invalid login body returns 400 with field-level errors', async () => {
    const res = await login({ username: '' });
    expect(res.status).toBe(400);
    const { issues } = (await res.json()) as { issues: { path: string }[] };
    expect(issues.map((i) => i.path).sort()).toEqual(['password', 'username']);
  });

  it('M4-1: passwords are stored as argon2id hashes, never in clear', async () => {
    await resetPassword(database.db, seedUsername, TEST_PASSWORD);
    const hash = await passwordHash();
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash).not.toContain(TEST_PASSWORD);
  });

  it('M4-1: only a hash of the session token is stored', async () => {
    const cookie = await logIn(app, database.db);
    const token = cookie.split('=')[1]!;
    const rows = await queryRows<{ id: string }>(database.db, sql`select id from sessions`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.id).not.toContain(token);
  });

  it('M4-2: an expired session gets 401', async () => {
    const authed = withCookie(app, await logIn(app, database.db));
    now = new Date(NOW.getTime() + SESSION_TTL_MS - 1);
    expect((await authed.request('/api/today')).status).toBe(200);
    now = new Date(NOW.getTime() + SESSION_TTL_MS);
    expect((await authed.request('/api/today')).status).toBe(401);
  });

  it('M4-2: every api route except login and health returns 401 without a valid session', async () => {
    const routes = app.routes.filter(
      (r) => r.method !== 'ALL' && r.path !== '/api/login' && r.path !== '/api/health',
    );
    expect(routes.length).toBeGreaterThan(3);
    const forged = withCookie(app, `${SESSION_COOKIE}=${'A'.repeat(43)}`);
    for (const route of routes) {
      const path = route.path.replace(/:[^/]+/g, '00000000-0000-4000-8000-000000000000');
      for (const client of [app, forged]) {
        const res = await client.request(path, {
          method: route.method,
          headers: { 'Content-Type': 'application/json' },
          ...(route.method === 'GET' ? {} : { body: '{}' }),
        });
        expect(res.status, `${route.method} ${route.path}`).toBe(401);
      }
    }
    // Unknown api paths don't reveal what exists either.
    expect((await app.request('/api/nope')).status).toBe(401);
  });

  it('M4-2: health and login answer without a session', async () => {
    expect((await app.request('/api/health')).status).toBe(200);
    expect((await login({ username: 'nobody', password: 'x' })).status).toBe(401);
    expect((await login({})).status).toBe(400);
  });
});

describe('seed passwords (M4-1, M4-5)', () => {
  let database: Database;

  beforeEach(async () => {
    database = await createMigratedTestDatabase();
  });

  afterEach(async () => {
    await database.close();
  });

  const hashes = async () =>
    queryRows<{ username: string; password_hash: string | null }>(
      database.db,
      sql`select username, password_hash from users order by username`,
    );

  it('M4-1: reads initial passwords from SEED_PASSWORD_<USERNAME>', () => {
    expect(seedPasswordVariable('mlewand')).toBe('SEED_PASSWORD_MLEWAND');
    expect(seedPasswordVariable('a.b-c')).toBe('SEED_PASSWORD_A_B_C');
    expect(
      seedPasswordsFromEnv({ SEED_PASSWORD_MLEWAND: 'secret-1', SEED_PASSWORD_OTHER: 'x' }),
    ).toEqual({ mlewand: 'secret-1' });
    expect(seedPasswordsFromEnv({ SEED_PASSWORD_MLEWAND: '' })).toEqual({});
  });

  it('M4-1: the seed stores only an argon2id hash of the initial password', async () => {
    const result = await seed(database.db, undefined, { [seedUsername]: TEST_PASSWORD });
    expect(result.withoutPassword).toEqual([]);
    const [row] = await hashes();
    expect(row!.password_hash).toMatch(/^\$argon2id\$/);
    const app = createApp({ db: database.db });
    const res = await app.request('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: seedUsername, password: TEST_PASSWORD }),
    });
    expect(res.status).toBe(204);
  });

  it('M4-5: seeding again keeps the password hash (it is set only while none is)', async () => {
    await seed(database.db, undefined, { [seedUsername]: TEST_PASSWORD });
    const first = await hashes();
    await seed(database.db, undefined, { [seedUsername]: TEST_PASSWORD });
    await seed(database.db, undefined, { [seedUsername]: 'another password' });
    await seed(database.db);
    expect(await hashes()).toEqual(first);
  });

  it('M4-1: a reset password survives the next seed', async () => {
    await seed(database.db, undefined, { [seedUsername]: TEST_PASSWORD });
    await resetPassword(database.db, seedUsername, 'the new password');
    const reset = await hashes();
    await seed(database.db, undefined, { [seedUsername]: TEST_PASSWORD });
    expect(await hashes()).toEqual(reset);
  });

  it('M4-1: the seed reports users without a password', async () => {
    expect(await seed(database.db)).toEqual({
      withoutPassword: seedData.users.map((u) => u.user.username),
    });
  });

  it('M4-1: a too short initial password is refused before anything is written', async () => {
    await expect(seed(database.db, undefined, { [seedUsername]: 'short' })).rejects.toThrow(
      /at least 8/,
    );
    expect(await hashes()).toEqual([]);
  });
});

describe('password command (M4-1)', () => {
  let database: Database;

  beforeEach(async () => {
    database = await createMigratedTestDatabase();
    await seed(database.db);
  });

  afterEach(async () => {
    await database.close();
  });

  it('M4-1: resets a password; the old one stops working', async () => {
    const app = createApp({ db: database.db });
    const login = (password: string) =>
      app.request('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: seedUsername, password }),
      });
    await resetPassword(database.db, seedUsername, 'first password');
    await resetPassword(database.db, seedUsername, 'second password');
    expect((await login('first password')).status).toBe(401);
    expect((await login('second password')).status).toBe(204);
  });

  it('M4-1: rejects an unknown user and a too short password', async () => {
    await expect(resetPassword(database.db, 'nobody', 'long enough')).rejects.toThrow(
      'No user named nobody.',
    );
    await expect(resetPassword(database.db, seedUsername, 'short')).rejects.toThrow(/at least 8/);
  });

  it('M4-1: reads the password up to the first line break', () => {
    expect(passwordFromInput('pass word\n')).toBe('pass word');
    expect(passwordFromInput('pass word\r\nrest')).toBe('pass word');
    expect(passwordFromInput('')).toBe('');
  });

  it('M4-1: two hashes of one password differ (random salt)', async () => {
    expect(await hashPassword(TEST_PASSWORD)).not.toBe(await hashPassword(TEST_PASSWORD));
  });
});
