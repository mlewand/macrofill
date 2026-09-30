import { expect, it } from 'vitest';

it('web tests run in a timezone other than the users', () => {
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Los_Angeles');
});
