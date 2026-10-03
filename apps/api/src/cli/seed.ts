// `pnpm db:seed`: loads the seed data; safe to run again (M4-5). Products go only into an empty
// product store (#63-7). Initial passwords come from
// SEED_PASSWORD_<USERNAME> and are only set for users without one (M4-1).
import { loadConfig } from '../config';
import { connect } from '../db/client';
import { assertSchemaCurrent } from '../db/migrations';
import { seed, seedPasswordsFromEnv, seedPasswordVariable } from '../seed/seed';
import { describeError } from '../errors';

const config = loadConfig(process.env);
const database = connect(config.databaseUrl);

try {
  await assertSchemaCurrent(database.db, config.migrationsDir);
  const { withoutPassword, missingDefaultProducts } = await seed(
    database.db,
    undefined,
    seedPasswordsFromEnv(process.env),
  );
  console.log('Seed data loaded.');
  for (const id of missingDefaultProducts) {
    console.warn(
      `A recipe step's default product ${id} isn't in the product store, which already holds products, so the step has no default. Add the product in the app.`,
    );
  }
  for (const username of withoutPassword) {
    console.warn(
      `User ${username} has no password and can't log in: set ${seedPasswordVariable(username)} and seed again, or run the password command.`,
    );
  }
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
} finally {
  await database.close();
}
