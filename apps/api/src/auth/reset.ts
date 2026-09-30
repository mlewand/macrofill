import type { Db } from '../db/client';
import { createAuthRepository } from '../repositories/auth';
import { assertSettablePassword, hashPassword } from './password';

/** M4-1: sets a user's password, replacing any earlier one. Rejects an unknown username. */
export async function resetPassword(db: Db, username: string, password: string): Promise<void> {
  assertSettablePassword(password);
  const updated = await createAuthRepository(db).setPasswordHash(
    username,
    await hashPassword(password),
  );
  if (!updated) throw new Error(`No user named ${username}.`);
}

/** The password from the command's stdin: everything up to the first line break. */
export function passwordFromInput(input: string): string {
  return input.split(/\r?\n/, 1)[0] ?? '';
}
