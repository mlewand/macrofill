import { z } from 'zod';

const envSchema = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WEB_DIST: z.string().min(1).optional(),
});

export interface Config {
  port: number;
  /** Built `apps/web` to serve (production). Unset in development, where Vite serves it. */
  webDist?: string;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${issues.join('\n')}`);
  }
  const { API_PORT, WEB_DIST } = result.data;
  return { port: API_PORT, ...(WEB_DIST === undefined ? {} : { webDist: WEB_DIST }) };
}
