import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const ci = readFileSync(`${root}/.github/workflows/ci.yml`, 'utf8');
const compose = readFileSync(`${root}/docker-compose.yml`, 'utf8');

/** The text of one job in ci.yml, up to the next job. */
function job(name: string): string {
  const match = new RegExp(`^  ${name}:\\n((?:    .*\\n|\\n)*)`, 'm').exec(ci);
  expect(match, `job ${name}`).not.toBeNull();
  return match![1]!;
}

describe('CI', () => {
  it('M1-6: runs the api tests against the host Postgres version in a service container', () => {
    const api = job('api-postgres');
    expect(api).toMatch(/^ {8}image: postgres:17$/m);
    expect(api).toMatch(/^ {6}API_TEST_DATABASE_URL: postgres:\/\/.+@localhost:5432\//m);
    expect(api).toMatch(/^ {6}- run: pnpm test --project api$/m);
  });

  it('M1-4, M1-6: local Postgres and CI use the same version', () => {
    expect(compose).toMatch(/image: postgres:17\b/);
  });
});
