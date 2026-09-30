import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/db/client';
import { migrated } from './support/db';

describe('test databases (M1-6)', () => {
  it('M1-6: a test database whose migration fails is closed, so a server one is dropped (regression: #35)', async () => {
    const failure = new Error('migration failed');
    const database = {
      db: {} as Database['db'],
      migrate: vi.fn(() => Promise.reject(failure)),
      close: vi.fn(() => Promise.resolve()),
    };
    await expect(migrated(database, '/migrations')).rejects.toBe(failure);
    expect(database.close).toHaveBeenCalledOnce();
  });

  it('M1-6: a migrated test database stays open', async () => {
    const database = {
      db: {} as Database['db'],
      migrate: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
    };
    await expect(migrated(database, '/migrations')).resolves.toBe(database);
    expect(database.close).not.toHaveBeenCalled();
  });
});
