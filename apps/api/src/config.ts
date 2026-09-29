import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const envSchema = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  MIGRATIONS_DIR: z.string().min(1).optional(),
  WEB_DIST: z.string().min(1).optional(),
});

export interface Config {
  port: number;
  databaseUrl: string;
  /** Drizzle migrations. Defaults to `apps/api/drizzle`; the production image sets its own. */
  migrationsDir: string;
  /** Built `apps/web` to serve (production). Unset in development, where Vite serves it. */
  webDist?: string;
}

const defaultMigrationsDir = fileURLToPath(new URL('../drizzle', import.meta.url));

export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    // Paths and messages only: values like DATABASE_URL hold secrets.
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${issues.join('\n')}`);
  }
  const { API_PORT, DATABASE_URL, MIGRATIONS_DIR, WEB_DIST } = result.data;
  return {
    port: API_PORT,
    databaseUrl: DATABASE_URL,
    migrationsDir: MIGRATIONS_DIR ?? defaultMigrationsDir,
    ...(WEB_DIST === undefined ? {} : { webDist: WEB_DIST }),
  };
}
