import { serve } from '@hono/node-server';
import { loadConfig } from './config';
import { connect } from './db/client';
import { startServer } from './start';

const config = loadConfig(process.env);
const database = connect(config.databaseUrl);

try {
  const server = await startServer(config, database, serve);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close(() => {
        void database.close().finally(() => process.exit(0));
      });
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  await database.close();
  process.exit(1);
}
