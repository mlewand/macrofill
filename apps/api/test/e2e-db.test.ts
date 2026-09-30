import { describe, expect, it } from 'vitest';
import { e2eDatabaseName } from '../src/db/e2e';

describe('e2e database guard', () => {
  it('accepts a database whose name ends in _e2e', () => {
    expect(e2eDatabaseName('postgres://u:p@localhost:5432/macrofill_e2e')).toBe('macrofill_e2e');
  });

  it.each([
    'postgres://u:p@localhost:5432/macrofill',
    'postgres://u:p@localhost:5432/macrofill_e2e_backup',
    'postgres://u:p@localhost:5432/e2e',
    'postgres://u:p@localhost:5432/',
  ])('refuses to reset %s', (url) => {
    expect(() => e2eDatabaseName(url)).toThrow(/_e2e/);
  });

  it('never prints the password', () => {
    expect(() => e2eDatabaseName('postgres://u:secret-password@localhost:5432/macrofill')).toThrow(
      expect.not.objectContaining({
        message: expect.stringContaining('secret-password') as unknown,
      }),
    );
  });
});
