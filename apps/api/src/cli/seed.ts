// `pnpm db:seed`: loads the seed data; safe to run again (M4-5).
import { loadConfig } from '../config';
import { connect } from '../db/client';
import { assertSchemaCurrent } from '../db/migrations';
import { seed } from '../seed/seed';
import { describeError } from '../errors';

const config = loadConfig(process.env);
const database = connect(config.databaseUrl);

try {
  await assertSchemaCurrent(database.db, config.migrationsDir);
  await seed(database.db);
  console.log('Seed data loaded.');
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
} finally {
  await database.close();
}
