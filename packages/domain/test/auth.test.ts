import { describe, expect, it } from 'vitest';
import { loginRequestSchema, USERNAME_MAX_LENGTH, userSchema } from '../src/index.js';

const user = (username: string) => ({
  id: '6c1f0e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
  username,
  timezone: 'Europe/Warsaw',
});

describe('login and user schemas (M4-1)', () => {
  it('M4-1: every username a user can have can log in (regression: #34)', () => {
    const longest = 'u'.repeat(USERNAME_MAX_LENGTH);
    expect(userSchema.safeParse(user(longest)).success).toBe(true);
    expect(loginRequestSchema.safeParse({ username: longest, password: 'p' }).success).toBe(true);
    expect(userSchema.safeParse(user(`${longest}u`)).success).toBe(false);
    expect(loginRequestSchema.safeParse({ username: `${longest}u`, password: 'p' }).success).toBe(
      false,
    );
  });
});
