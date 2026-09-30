import { z } from 'zod';

/** The longest password: a login can't make the server hash megabytes. */
export const PASSWORD_MAX_LENGTH = 1024;

/** M4-1: the login form. */
export const loginRequestSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
