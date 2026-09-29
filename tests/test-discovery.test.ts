import { fileURLToPath } from 'node:url';
import { createVitest } from 'vitest/node';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

// Projects allowed to have no tests yet. Remove an entry as soon as the project gets tests
// (and drop --passWithNoTests from its package test script).
const allowedEmpty = new Set(['scale']);

// With Vitest projects, a project that discovers no tests doesn't fail the run, so a broken
// include glob or config would silently drop its tests. This guards against that.
describe('every test project discovers its tests', () => {
  it('finds test files in each workspace project', async () => {
    const vitest = await createVitest('test', { root, watch: false }, {}, {});
    try {
      const specs = await vitest.globTestSpecifications();
      const counts = new Map(vitest.projects.map((p) => [p.name, 0]));
      for (const spec of specs) {
        counts.set(spec.project.name, (counts.get(spec.project.name) ?? 0) + 1);
      }

      expect([...counts.keys()].sort()).toEqual(['api', 'domain', 'repo', 'scale', 'web']);
      for (const [name, count] of counts) {
        if (allowedEmpty.has(name)) {
          expect(count, `${name} has tests now; remove it from allowedEmpty`).toBe(0);
        } else {
          expect(count, `project ${name} discovered no test files`).toBeGreaterThan(0);
        }
      }
    } finally {
      await vitest.close();
    }
  });
});
