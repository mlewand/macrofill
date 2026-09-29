import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
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
  },
});
