// `pnpm -F @macrofill/api e2e:db`: gives the e2e tests a fresh database. Creates it if it's
// missing, empties it, migrates and seeds. Playwright runs it before starting the server.
// Only for databases named *_e2e (see e2eDatabaseName); not part of the production image.
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { loadConfig } from '../config';
import { connect } from '../db/client';
import { e2eDatabaseName } from '../db/e2e';
import { seed } from '../seed/seed';

const config = loadConfig(process.env);

async function createIfMissing(name: string) {
  // The server's maintenance database, reached with the same role.
  const adminUrl = new URL(config.databaseUrl);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const exists = await admin.query('select 1 from pg_database where datname = $1', [name]);
    if (exists.rowCount === 0) {
      await admin.query(`create database "${name.replaceAll('"', '""')}"`);
      console.log(`Created database ${name}.`);
    }
  } finally {
    await admin.end();
  }
}

try {
  const name = e2eDatabaseName(config.databaseUrl);
  await createIfMissing(name).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Couldn't create database ${name} (${reason}). Create it yourself, owned by the app's role, or point E2E_DATABASE_URL at one.`,
    );
  });
  const database = connect(config.databaseUrl);
  try {
    await database.db.execute(sql`drop schema if exists drizzle cascade`);
    await database.db.execute(sql`drop schema public cascade`);
    await database.db.execute(sql`create schema public`);
    await database.migrate(config.migrationsDir);
    await seed(database.db);
  } finally {
    await database.close();
  }
  console.log(`Database ${name} is fresh: migrated and seeded.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
