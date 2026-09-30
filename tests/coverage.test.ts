import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config from '../vitest.config';

const root = fileURLToPath(new URL('..', import.meta.url));

// M1-3: the thresholds in ARCHITECTURE.md, per package, measured over the whole test run.
const expected = {
  'packages/domain/src/**': 90,
  'packages/scale/src/**': 70,
  'apps/api/src/**': 70,
  'apps/web/src/**': 70,
};

const coverage = config.test?.coverage;

describe('coverage thresholds', () => {
  it('M1-3: each package has its line coverage threshold', () => {
    expect(coverage?.provider).toBe('v8');
    const thresholds = new Map(
      Object.entries((coverage && 'thresholds' in coverage && coverage.thresholds) || {}),
    );
    for (const [glob, lines] of Object.entries(expected)) {
      expect(thresholds.get(glob), glob).toEqual({ lines });
    }
  });

  it('M1-3: every threshold glob matches source files', () => {
    // A glob that matches nothing passes any threshold, so a moved package would go unchecked.
    for (const glob of Object.keys(expected)) {
      expect(globSync(glob, { cwd: root }).length, glob).toBeGreaterThan(0);
    }
  });

  it('M1-3: entry points are excluded, the rest is measured', () => {
    const include = coverage?.include ?? [];
    const exclude = coverage?.exclude ?? [];
    expect(include).toEqual(Object.keys(expected));
    for (const entry of [
      'apps/api/src/server.ts',
      'apps/api/src/cli/seed.ts',
      'apps/web/src/main.tsx',
    ]) {
      expect(
        exclude.some((glob) => globSync(glob, { cwd: root }).includes(entry)),
        entry,
      ).toBe(true);
    }
  });

  it('M1-3: CI runs the tests with coverage', () => {
    const { scripts } = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(scripts['test:coverage']).toBe('vitest run --coverage');
    const ci = readFileSync(`${root}/.github/workflows/ci.yml`, 'utf8');
    expect(ci).toMatch(/^\s+- run: pnpm test:coverage$/m);
  });
});
