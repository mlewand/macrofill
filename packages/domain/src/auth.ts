import { z } from 'zod';

/** The longest username, for users (`userSchema`) and the login form alike. */
export const USERNAME_MAX_LENGTH = 200;

/** The longest password: a login can't make the server hash megabytes. */
export const PASSWORD_MAX_LENGTH = 1024;

/** M4-1: the login form. */
export const loginRequestSchema = z.object({
  username: z.string().min(1).max(USERNAME_MAX_LENGTH),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** `GET /me`: who the session belongs to. */
export const meSchema = z.object({ username: z.string().min(1) });

export type Me = z.infer<typeof meSchema>;
