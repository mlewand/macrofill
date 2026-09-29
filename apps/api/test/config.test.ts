import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const DATABASE_URL = 'postgres://macrofill:secret-password@db:5432/macrofill';

describe('api config from the environment', () => {
  it('defaults the port and migrations directory, and serves no web build', () => {
    const config = loadConfig({ DATABASE_URL });
    expect(config).toEqual({
      port: 3000,
      databaseUrl: DATABASE_URL,
      migrationsDir: expect.stringMatching(/apps\/api\/drizzle$/) as unknown,
    });
  });

  it('reads API_PORT, WEB_DIST and MIGRATIONS_DIR (M1-5)', () => {
    expect(
      loadConfig({
        DATABASE_URL,
        API_PORT: '8080',
        WEB_DIST: '/app/public',
        MIGRATIONS_DIR: '/app/drizzle',
      }),
    ).toEqual({
      port: 8080,
      databaseUrl: DATABASE_URL,
      migrationsDir: '/app/drizzle',
      webDist: '/app/public',
    });
  });

  it.each(['abc', '0', '70000', '3.5'])('rejects API_PORT=%s', (port) => {
    expect(() => loadConfig({ DATABASE_URL, API_PORT: port })).toThrow(/API_PORT/);
  });

  it('requires DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('never prints DATABASE_URL, which holds the password', () => {
    expect(() => loadConfig({ DATABASE_URL, API_PORT: 'abc' })).toThrow(
      expect.not.objectContaining({
        message: expect.stringContaining('secret-password') as unknown,
      }),
    );
  });
});
