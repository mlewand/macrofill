// `pnpm db:password <username>`: sets a user's password (M4-1), read from stdin so it stays out
// of the shell history and the process list. Sessions already logged in stay valid.
import { text } from 'node:stream/consumers';
import { passwordFromInput, resetPassword } from '../auth/reset';
import { loadConfig } from '../config';
import { connect } from '../db/client';
import { assertSchemaCurrent } from '../db/migrations';
import { describeError } from '../errors';

const username = process.argv[2];
if (username === undefined) {
  console.error('Usage: pnpm db:password <username>, with the new password on stdin.');
  process.exit(2);
}
if (process.stdin.isTTY)
  console.error(`New password for ${username} (shown as you type), then Enter:`);
const password = passwordFromInput(await text(process.stdin));

const config = loadConfig(process.env);
const database = connect(config.databaseUrl);

try {
  await assertSchemaCurrent(database.db, config.migrationsDir);
  await resetPassword(database.db, username, password);
  console.log(`Password set for ${username}.`);
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
} finally {
  await database.close();
}
