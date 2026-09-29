import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

describe('api config from the environment', () => {
  it('defaults the port and serves no web build', () => {
    expect(loadConfig({})).toEqual({ port: 3000 });
  });

  it('reads API_PORT and WEB_DIST (M1-5)', () => {
    expect(loadConfig({ API_PORT: '8080', WEB_DIST: '/app/public' })).toEqual({
      port: 8080,
      webDist: '/app/public',
    });
  });

  it.each(['abc', '0', '70000', '3.5'])('rejects API_PORT=%s', (port) => {
    expect(() => loadConfig({ API_PORT: port })).toThrow(/API_PORT/);
  });
});
