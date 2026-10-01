import { sql } from 'drizzle-orm';
import pg from 'pg';
import { seed, type SeedPasswords } from '../seed/seed';
import type { Database } from './client';

/**
 * The database name in `databaseUrl`, if it's safe for the e2e reset to wipe it: the name must end
 * in `_e2e`. Anything else, the dev database included, is refused.
 */
export function e2eDatabaseName(databaseUrl: string): string {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!/^.+_e2e$/.test(name)) {
    throw new Error(
      `Refusing to reset database "${name}": the e2e database's name must end in _e2e.`,
    );
  }
  return name;
}

/** The part of a `pg.Client` the reset needs, so tests can pass a fake. */
export interface AdminClient {
  query: (text: string, params?: unknown[]) => Promise<{ rowCount: number | null }>;
  end: () => Promise<void>;
}

/**
 * Connects to the server's maintenance database, giving up after `timeoutMs` (default 5 s) so an
 * unreachable server fails e2e setup instead of hanging it.
 */
export async function connectAdminClient(adminUrl: string, timeoutMs = 5000): Promise<AdminClient> {
  const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: timeoutMs });
  await admin.connect();
  return admin;
}

/** Creates the database unless it exists; returns whether it did. Always closes `admin`. */
export async function createDatabaseIfMissing(admin: AdminClient, name: string): Promise<boolean> {
  try {
    const exists = await admin.query('select 1 from pg_database where datname = $1', [name]);
    if (exists.rowCount !== 0) return false;
    await admin.query(`create database "${name.replaceAll('"', '""')}"`);
    return true;
  } finally {
    await admin.end();
  }
}

/** Empties the database (both schemas), then migrates and seeds it. */
export async function resetDatabase(
  database: Database,
  migrationsDir: string,
  passwords: SeedPasswords = {},
): Promise<void> {
  await database.db.execute(sql`drop schema if exists drizzle cascade`);
  await database.db.execute(sql`drop schema if exists public cascade`);
  await database.db.execute(sql`create schema public`);
  await database.migrate(migrationsDir);
  await seed(database.db, undefined, passwords);
}

/**
 * Gives e2e a fresh database: checks the name, creates the database if missing (through the
 * server's `postgres` maintenance database, with the same role), resets it and closes it.
 */
export async function prepareE2eDatabase(options: {
  databaseUrl: string;
  migrationsDir: string;
  connectAdmin: (adminUrl: string) => Promise<AdminClient>;
  connectDatabase: (databaseUrl: string) => Database;
  /** Initial passwords for the seed, so e2e can log in. */
  passwords?: SeedPasswords;
}): Promise<{ name: string; created: boolean }> {
  const name = e2eDatabaseName(options.databaseUrl);
  const adminUrl = new URL(options.databaseUrl);
  adminUrl.pathname = '/postgres';
  let created: boolean;
  try {
    created = await createDatabaseIfMissing(await options.connectAdmin(adminUrl.toString()), name);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Couldn't create database ${name} (${reason}). Create it yourself, owned by the app's role, or point E2E_DATABASE_URL at one.`,
      { cause: error },
    );
  }
  const database = options.connectDatabase(options.databaseUrl);
  try {
    await resetDatabase(database, options.migrationsDir, options.passwords);
  } finally {
    await database.close();
  }
  return { name, created };
}
