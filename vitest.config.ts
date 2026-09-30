import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'apps/*',
      {
        test: {
          name: 'repo',
          include: ['tests/**/*.test.ts'],
        },
      },
    ],
    // M1-3, with `pnpm test:coverage`: line coverage per package (thresholds in ARCHITECTURE.md),
    // measured over the whole run. Vitest takes coverage settings only here, not per project.
    coverage: {
      provider: 'v8',
      include: [
        'packages/domain/src/**',
        'packages/scale/src/**',
        'apps/api/src/**',
        'apps/web/src/**',
      ],
      // Entry points: they only wire the tested modules together and run them.
      exclude: ['apps/api/src/server.ts', 'apps/api/src/cli/**', 'apps/web/src/main.tsx'],
      thresholds: {
        'packages/domain/src/**': { lines: 90 },
        'packages/scale/src/**': { lines: 70 },
        'apps/api/src/**': { lines: 70 },
        'apps/web/src/**': { lines: 70 },
      },
    },
  },
});
