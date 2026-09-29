import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { Database } from '../src/db/client';
import { createMigratedTestDatabase } from './support/db';

describe('M4-8: health endpoint checks the database connection', () => {
  let database: Database | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  it('returns 200 when the database answers', async () => {
    database = await createMigratedTestDatabase();
    const res = await createApp({ db: database.db }).request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('returns 503 when the database does not answer', async () => {
    database = await createMigratedTestDatabase();
    const app = createApp({ db: database.db });
    await database.close();
    database = undefined;
    const res = await app.request('/api/health');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'unavailable' });
  });
});
