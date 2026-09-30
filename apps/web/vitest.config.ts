import react from '@vitejs/plugin-react';
import { defineProject } from 'vitest/config';

export default defineProject({
  plugins: [react()],
  test: {
    name: 'web',
    environment: 'jsdom',
    // Far from the users' Europe/Warsaw, so a time shown in the device's timezone instead of the
    // user's fails the tests on any machine (this VM runs in Warsaw time, CI in UTC).
    env: { TZ: 'America/Los_Angeles' },
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
