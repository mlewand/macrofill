import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { queryRows } from '../src/db/client';
import { createTestDatabase, testDatabaseKind } from './support/db';

// M1-6: in CI the api tests also run against a Postgres server (API_TEST_DATABASE_URL), the host's
// version. Locally, without it, they use PGlite and this is skipped.
describe.runIf(testDatabaseKind === 'server')(
  'M1-6: api tests on the host Postgres version',
  () => {
    it('M1-6: runs against Postgres 17', async () => {
      const database = await createTestDatabase();
      try {
        const [row] = await queryRows<{ server_version_num: string }>(
          database.db,
          sql`show server_version_num`,
        );
        expect(Math.floor(Number(row!.server_version_num) / 10000)).toBe(17);
      } finally {
        await database.close();
      }
    });
  },
);
