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
        totalTimeoutMs: 10_000,
        openFoodFactsUrl: 'https://world.openfoodfacts.org',
        usdaUrl: 'https://api.nal.usda.gov',
        userAgent: 'Macrofill/dev (macrofill_app@mlewandowski.com)',
      },
    });
  });

  it('#67-5: USDA FoodData Central is used only with an API key, which is never part of the defaults', () => {
    expect(loadConfig({ DATABASE_URL }).lookup).not.toHaveProperty('usdaApiKey');
    expect(loadConfig({ DATABASE_URL, USDA_API_KEY: '' }).lookup).not.toHaveProperty('usdaApiKey');
    expect(loadConfig({ DATABASE_URL, USDA_API_KEY: 'abc123' }).lookup.usdaApiKey).toBe('abc123');
  });

  it('#67-2: the time of the whole lookup and the USDA address come from the environment', () => {
    expect(
      loadConfig({
        DATABASE_URL,
        LOOKUP_TOTAL_TIMEOUT_MS: '8000',
        USDA_API_URL: 'http://127.0.0.1:9998',
      }).lookup,
    ).toMatchObject({ totalTimeoutMs: 8000, usdaUrl: 'http://127.0.0.1:9998' });
  });

  it.each(['0', '-5', 'abc', '1.5', '20001'])(
    'rejects LOOKUP_TOTAL_TIMEOUT_MS=%s (the app waits 25 s)',
    (value) => {
      expect(() => loadConfig({ DATABASE_URL, LOOKUP_TOTAL_TIMEOUT_MS: value })).toThrow(
        /LOOKUP_TOTAL_TIMEOUT_MS/,
      );
    },
  );

  it('never prints the USDA key when the environment is invalid', () => {
    expect(() =>
      loadConfig({ DATABASE_URL, USDA_API_KEY: 'secret-usda-key', API_PORT: 'abc' }),
    ).toThrow(
      expect.not.objectContaining({
        message: expect.stringContaining('secret-usda-key') as unknown,
      }),
    );
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
    ).toMatchObject({
      timeoutMs: 2500,
      openFoodFactsUrl: 'http://127.0.0.1:9999',
      userAgent: 'Macrofill/abc1234 (me@example.com)',
    });
  });

  it.each(['0', '-5', 'abc', '1.5', '20001', '60000'])(
    'rejects LOOKUP_TIMEOUT_MS=%s (the app waits 25 s; regression: #74)',
    (value) => {
      expect(() => loadConfig({ DATABASE_URL, LOOKUP_TIMEOUT_MS: value })).toThrow(
        /LOOKUP_TIMEOUT_MS/,
      );
    },
  );

  it('accepts the longest time the app still waits for (regression: #74)', () => {
    expect(loadConfig({ DATABASE_URL, LOOKUP_TIMEOUT_MS: '20000' }).lookup.timeoutMs).toBe(20_000);
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
