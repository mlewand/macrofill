import { serve } from '@hono/node-server';
import { createApp } from './app';
import type { Config } from './config';
import type { Database } from './db/client';
import { assertSchemaCurrent } from './db/migrations';
import { dummyHash } from './services/auth';

/** Checks the schema, then starts listening. Rejects without listening if the schema is behind (M4-9). */
export async function startServer<S>(
  config: Config,
  database: Database,
  listen: (...args: Parameters<typeof serve>) => S,
): Promise<S> {
  await assertSchemaCurrent(database.db, config.migrationsDir);
  // M4-1: before the first login, so it can't tell an unknown username by its timing.
  await dummyHash();
  const app = createApp({
    db: database.db,
    ...(config.webDist === undefined ? {} : { webDist: config.webDist }),
  });
  return listen({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`api listening on :${info.port}`);
  });
}
