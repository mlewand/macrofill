import type { SQL } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema';

/** Any Drizzle Postgres database with our schema: node-postgres in production, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: Db;
  /** Applies pending migrations. Only the explicit migrate command calls this (M4-9). */
  migrate(migrationsFolder: string): Promise<void>;
  close(): Promise<void>;
}

export function connect(databaseUrl: string): Database {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return {
    db,
    migrate: (migrationsFolder) => migrate(db, { migrationsFolder }),
    close: () => pool.end(),
  };
}

/** Rows of a raw query. Both drivers (node-postgres and PGlite) return them as `rows`. */
export async function queryRows<T>(db: Db, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as { rows: T[] };
  return result.rows;
}
