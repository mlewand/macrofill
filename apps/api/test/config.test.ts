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
      lookup: {
        timeoutMs: 5000,
        openFoodFactsUrl: 'https://world.openfoodfacts.org',
        userAgent: 'Macrofill/dev (macrofill_app@mlewandowski.com)',
      },
    });
  });

  it('#66-4: the lookup time, the Open Food Facts address, the version and the contact come from the environment', () => {
    expect(
      loadConfig({
        DATABASE_URL,
        LOOKUP_TIMEOUT_MS: '2500',
        OPEN_FOOD_FACTS_URL: 'http://127.0.0.1:9999',
        APP_VERSION: 'abc1234',
        LOOKUP_CONTACT: 'me@example.com',
      }).lookup,
    ).toEqual({
      timeoutMs: 2500,
      openFoodFactsUrl: 'http://127.0.0.1:9999',
      userAgent: 'Macrofill/abc1234 (me@example.com)',
    });
  });

  it.each(['0', '-5', 'abc', '1.5', '60001'])('rejects LOOKUP_TIMEOUT_MS=%s', (value) => {
    expect(() => loadConfig({ DATABASE_URL, LOOKUP_TIMEOUT_MS: value })).toThrow(
      /LOOKUP_TIMEOUT_MS/,
    );
  });

  it('rejects an Open Food Facts address that is not a URL', () => {
    expect(() => loadConfig({ DATABASE_URL, OPEN_FOOD_FACTS_URL: 'not a url' })).toThrow(
      /OPEN_FOOD_FACTS_URL/,
    );
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
      lookup: expect.any(Object) as unknown,
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
