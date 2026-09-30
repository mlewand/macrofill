// `pnpm db:migrate`: the only way migrations are applied (M4-9).
import { loadConfig } from '../config';
import { connect } from '../db/client';
import { describeError } from '../errors';

const config = loadConfig(process.env);
const database = connect(config.databaseUrl);

try {
  await database.migrate(config.migrationsDir);
  console.log('Migrations applied.');
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
} finally {
  await database.close();
}
