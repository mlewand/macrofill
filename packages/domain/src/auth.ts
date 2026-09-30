import { z } from 'zod';

/** M4-1: the login form. Bounded, so a huge body can't make the server hash megabytes. */
export const loginRequestSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(1024),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
