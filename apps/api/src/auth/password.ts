import { randomBytes } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';

// M4-1: argon2id with OWASP's minimum parameters (19 MiB, 2 passes, 1 lane). WebAssembly, so the
// production image needs no native module.
const params = { parallelism: 1, iterations: 2, memorySize: 19 * 1024, hashLength: 32 } as const;

/** Passwords shorter than this are refused when set (seed and the password command). */
export const MIN_PASSWORD_LENGTH = 8;

/** The encoded hash (`$argon2id$v=19$m=…`), with its own random salt. */
export function hashPassword(password: string): Promise<string> {
  return argon2id({ ...params, password, salt: randomBytes(16), outputType: 'encoded' });
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return argon2Verify({ password, hash });
}

/** Refuses a password too short to set. */
export function assertSettablePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`A password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}
