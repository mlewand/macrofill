// `pnpm db:password <username>`: sets a user's password (M4-1), read from stdin so it stays out
// of the shell history and the process list. Sessions already logged in stay valid.
import { createInterface } from 'node:readline';
import { resetPassword } from '../auth/reset';
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
const password = await firstLine();

/** The first line on stdin, without its line break; empty if there's none. */
async function firstLine(): Promise<string> {
  const lines = createInterface({ input: process.stdin });
  try {
    for await (const line of lines) return line;
    return '';
  } finally {
    lines.close();
  }
}

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
