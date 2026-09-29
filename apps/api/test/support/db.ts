import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import type { Database, Db } from '../../src/db/client';
import * as schema from '../../src/db/schema';

export const migrationsDir = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** An in-process Postgres (PGlite) with our schema, not yet migrated. */
export function createTestDatabase(): Database {
  const client = new PGlite();
  const pglite = drizzle(client, { schema, casing: 'snake_case' });
  const db: Db = pglite;
  return {
    db,
    migrate: (migrationsFolder) => migrate(pglite, { migrationsFolder }),
    close: () => client.close(),
  };
}

/** A migrated test database. */
export async function createMigratedTestDatabase(): Promise<Database> {
  const database = createTestDatabase();
  await database.migrate(migrationsDir);
  return database;
}
