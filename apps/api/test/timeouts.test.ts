import { createServer, type Server, type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { connect, type Database } from '../src/db/client';
import { assertSchemaCurrent } from '../src/db/migrations';
import { migrationsDir } from './support/db';

/** Accepts TCP connections and never answers, like a database behind a black hole. */
function silentServer(): Promise<{ server: Server; port: number; sockets: Set<Socket> }> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('no port');
      resolve({ server, port: address.port, sockets });
    });
  });
}

describe('M4-8: an unresponsive database fails fast instead of hanging', () => {
  let silent: Awaited<ReturnType<typeof silentServer>>;
  let database: Database;

  beforeAll(async () => {
    silent = await silentServer();
    database = connect(`postgres://u:p@127.0.0.1:${silent.port}/db`);
  });

  afterAll(async () => {
    await database.close().catch(() => undefined);
    for (const socket of silent.sockets) socket.destroy();
    silent.server.close();
  });

  it('health returns 503 within the Docker healthcheck timeout (5 s)', async () => {
    const started = performance.now();
    const res = await createApp({ db: database.db }).request('/api/health');
    expect(res.status).toBe(503);
    expect(performance.now() - started).toBeLessThan(4000);
  });

  it('repeated probes each fail on their own instead of piling up', async () => {
    const app = createApp({ db: database.db });
    const started = performance.now();
    const statuses = await Promise.all(
      Array.from({ length: 15 }, async () => (await app.request('/api/health')).status),
    );
    expect(statuses.every((s) => s === 503)).toBe(true);
    expect(performance.now() - started).toBeLessThan(4000);
  });

  it('the startup schema check rejects instead of hanging', async () => {
    const started = performance.now();
    await expect(assertSchemaCurrent(database.db, migrationsDir)).rejects.toThrow();
    expect(performance.now() - started).toBeLessThan(4000);
  });
});
