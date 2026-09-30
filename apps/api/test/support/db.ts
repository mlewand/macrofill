import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { connect, type Database, type Db } from '../../src/db/client';
import * as schema from '../../src/db/schema';

export const migrationsDir = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * M1-6: with `API_TEST_DATABASE_URL` set (CI sets it to a Postgres 17 service, the host's version),
 * every test database is a fresh database on that server, created for the test and dropped when
 * it's closed. The role needs CREATEDB. Without it, tests use PGlite in-process.
 */
const serverUrl = process.env.API_TEST_DATABASE_URL;

/** Which Postgres the tests run against. */
export const testDatabaseKind: 'pglite' | 'server' = serverUrl ? 'server' : 'pglite';

/** A test database with our schema, not yet migrated. */
export function createTestDatabase(): Promise<Database> {
  return serverUrl ? createServerDatabase(serverUrl) : Promise.resolve(createPgliteDatabase());
}

/** A migrated test database. */
export async function createMigratedTestDatabase(): Promise<Database> {
  const database = await createTestDatabase();
  await database.migrate(migrationsDir);
  return database;
}

function createPgliteDatabase(): Database {
  const client = new PGlite();
  const pglite = drizzle(client, { schema, casing: 'snake_case' });
  const db: Db = pglite;
  return {
    db,
    migrate: (migrationsFolder) => migrate(pglite, { migrationsFolder }),
    close: () => client.close(),
  };
}

async function createServerDatabase(url: string): Promise<Database> {
  const name = `macrofill_test_${randomUUID().replaceAll('-', '')}`;
  await admin(url, `create database ${name}`);
  const databaseUrl = new URL(url);
  databaseUrl.pathname = `/${name}`;
  const database = connect(databaseUrl.toString());
  let closed: Promise<void> | undefined;
  return {
    ...database,
    // Once, however often a test closes it.
    close: () =>
      (closed ??= database
        .close()
        .then(() => admin(url, `drop database if exists ${name} with (force)`))),
  };
}

/** Runs one statement on the server's maintenance database. */
async function admin(url: string, statement: string): Promise<void> {
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}
