// `pnpm -F @macrofill/api e2e:db`: gives the e2e tests a fresh database. Creates it if it's
// missing, empties it, migrates and seeds. Playwright runs it before starting the server.
// Only for databases named *_e2e (see e2eDatabaseName); not part of the production image.
import pg from 'pg';
import { loadConfig } from '../config';
import { connect } from '../db/client';
import { prepareE2eDatabase } from '../db/e2e';

const config = loadConfig(process.env);

try {
  const { name, created } = await prepareE2eDatabase({
    databaseUrl: config.databaseUrl,
    migrationsDir: config.migrationsDir,
    connectAdmin: async (adminUrl) => {
      const admin = new pg.Client({ connectionString: adminUrl });
      await admin.connect();
      return admin;
    },
    connectDatabase: (databaseUrl) => connect(databaseUrl),
  });
  console.log(`${created ? 'Created' : 'Reset'} database ${name}: migrated and seeded.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
