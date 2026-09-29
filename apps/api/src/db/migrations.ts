import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { queryRows, type Db } from './client';

export class SchemaBehindError extends Error {
  override name = 'SchemaBehindError';
}

/**
 * How many migrations in `migrationsFolder` the database hasn't applied. Uses the same rule as
 * Drizzle's migrator: a migration is pending if it's newer than the last applied one. Reads only;
 * a database never migrated (no migrations table) has every migration pending.
 */
export async function pendingMigrations(db: Db, migrationsFolder: string): Promise<number> {
  const migrations = readMigrationFiles({ migrationsFolder });
  const [exists] = await queryRows<{ table: string | null }>(
    db,
    sql`select to_regclass('drizzle.__drizzle_migrations')::text as table`,
  );
  if (exists?.table == null) return migrations.length;
  const [last] = await queryRows<{ created_at: string | null }>(
    db,
    sql`select max(created_at)::text as created_at from drizzle.__drizzle_migrations`,
  );
  const lastApplied = Number(last?.created_at ?? -Infinity);
  return migrations.filter((m) => m.folderMillis > lastApplied).length;
}

/** M4-9: the api doesn't start on a schema that is behind. It never migrates on its own. */
export async function assertSchemaCurrent(db: Db, migrationsFolder: string): Promise<void> {
  const pending = await pendingMigrations(db, migrationsFolder);
  if (pending > 0) {
    throw new SchemaBehindError(
      `Database schema is behind: ${pending} pending migration${pending === 1 ? '' : 's'}. Run \`pnpm db:migrate\` first.`,
    );
  }
}
