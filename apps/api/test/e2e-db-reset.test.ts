import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { queryRows, type Database } from '../src/db/client';
import { createServer, type Socket } from 'node:net';
import {
  connectAdminClient,
  createDatabaseIfMissing,
  prepareE2eDatabase,
  resetDatabase,
  type AdminClient,
} from '../src/db/e2e';
import { pendingMigrations } from '../src/db/migrations';
import { seedData } from '../src/seed/data';
import { seed } from '../src/seed/seed';
import { createMigratedTestDatabase, createTestDatabase, migrationsDir } from './support/db';

function fakeAdmin(existing: string[], fail?: Error): AdminClient & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    query: vi.fn((text: string, params?: unknown[]) => {
      queries.push(text);
      if (fail) return Promise.reject(fail);
      if (text.startsWith('select')) {
        return Promise.resolve({ rowCount: existing.includes(String(params?.[0])) ? 1 : 0 });
      }
      return Promise.resolve({ rowCount: 0 });
    }),
    end: vi.fn(() => Promise.resolve()),
  };
}

describe('e2e database reset', () => {
  describe('createDatabaseIfMissing', () => {
    it('creates a missing database, and closes the admin connection', async () => {
      const admin = fakeAdmin([]);
      expect(await createDatabaseIfMissing(admin, 'macrofill_e2e')).toBe(true);
      expect(admin.queries.at(-1)).toBe('create database "macrofill_e2e"');
      expect(admin.end).toHaveBeenCalledOnce();
    });

    it('leaves an existing database alone', async () => {
      const admin = fakeAdmin(['macrofill_e2e']);
      expect(await createDatabaseIfMissing(admin, 'macrofill_e2e')).toBe(false);
      expect(admin.queries.some((q) => q.startsWith('create'))).toBe(false);
      expect(admin.end).toHaveBeenCalledOnce();
    });

    it('quotes the name safely', async () => {
      const admin = fakeAdmin([]);
      await createDatabaseIfMissing(admin, 'odd"name_e2e');
      expect(admin.queries.at(-1)).toBe('create database "odd""name_e2e"');
    });

    it('closes the admin connection when a query fails', async () => {
      const admin = fakeAdmin([], new Error('permission denied'));
      await expect(createDatabaseIfMissing(admin, 'macrofill_e2e')).rejects.toThrow(
        'permission denied',
      );
      expect(admin.end).toHaveBeenCalledOnce();
    });
  });

  describe('resetDatabase', () => {
    it('empties a used database, then migrates and seeds it', async () => {
      const database = await createMigratedTestDatabase();
      try {
        await seed(database.db);
        const owner = seedData.users[0]!.user.id;
        await database.db.execute(
          sql`insert into prepared_meals (id, owner_id, input_method, started_at, finished_at)
              values (gen_random_uuid(), ${owner}, 'direct', now(), now())`,
        );
        await database.db.execute(sql`create table leftover (id integer)`);

        await resetDatabase(database, migrationsDir);

        const [counts] = await queryRows<{
          meals: number;
          products: number;
          leftover: string | null;
        }>(
          database.db,
          sql`select (select count(*) from prepared_meals)::int as meals,
                     (select count(*) from products)::int as products,
                     to_regclass('public.leftover')::text as leftover`,
        );
        expect(counts).toEqual({ meals: 0, products: seedData.products.length, leftover: null });
        expect(await pendingMigrations(database.db, migrationsDir)).toBe(0);
      } finally {
        await database.close();
      }
    });

    it('works on a brand-new, never migrated database', async () => {
      const database = createTestDatabase();
      try {
        await resetDatabase(database, migrationsDir);
        expect(await pendingMigrations(database.db, migrationsDir)).toBe(0);
      } finally {
        await database.close();
      }
    });
  });

  describe('prepareE2eDatabase', () => {
    const url = 'postgres://u:secret@localhost:5432/macrofill_e2e';

    it('refuses anything not named *_e2e before connecting at all', async () => {
      const connectAdmin = vi.fn();
      const connectDatabase = vi.fn();
      await expect(
        prepareE2eDatabase({
          databaseUrl: 'postgres://u:p@localhost:5432/macrofill',
          migrationsDir,
          connectAdmin,
          connectDatabase,
        }),
      ).rejects.toThrow(/_e2e/);
      expect(connectAdmin).not.toHaveBeenCalled();
      expect(connectDatabase).not.toHaveBeenCalled();
    });

    it('creates, resets and closes the database', async () => {
      const admin = fakeAdmin([]);
      let database: Database | undefined;
      const connectAdmin = vi.fn((adminUrl: string) => {
        expect(new URL(adminUrl).pathname).toBe('/postgres');
        return Promise.resolve(admin);
      });
      const connectDatabase = vi.fn(() => {
        database = createTestDatabase();
        vi.spyOn(database, 'close');
        return database;
      });
      await expect(
        prepareE2eDatabase({ databaseUrl: url, migrationsDir, connectAdmin, connectDatabase }),
      ).resolves.toEqual({ name: 'macrofill_e2e', created: true });
      expect(database!.close).toHaveBeenCalledOnce();
    });

    it('explains how to fix a database it cannot create, without connecting to it', async () => {
      const connectDatabase = vi.fn();
      await expect(
        prepareE2eDatabase({
          databaseUrl: url,
          migrationsDir,
          connectAdmin: () => Promise.resolve(fakeAdmin([], new Error('permission denied'))),
          connectDatabase,
        }),
      ).rejects.toThrow(
        /Couldn't create database macrofill_e2e \(permission denied\).*E2E_DATABASE_URL/,
      );
      expect(connectDatabase).not.toHaveBeenCalled();
    });

    it('closes the database when the reset fails', async () => {
      let database: Database | undefined;
      await expect(
        prepareE2eDatabase({
          databaseUrl: url,
          migrationsDir: '/does/not/exist',
          connectAdmin: () => Promise.resolve(fakeAdmin(['macrofill_e2e'])),
          connectDatabase: () => {
            database = createTestDatabase();
            vi.spyOn(database, 'close');
            return database;
          },
        }),
      ).rejects.toThrow();
      expect(database!.close).toHaveBeenCalledOnce();
    });
  });

  describe('connectAdminClient', () => {
    it('gives up on an unresponsive server instead of hanging setup', async () => {
      const sockets = new Set<Socket>();
      const server = createServer((socket) => sockets.add(socket));
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as { port: number };
      try {
        const started = performance.now();
        await expect(
          connectAdminClient(`postgres://u:p@127.0.0.1:${port}/postgres`, 500),
        ).rejects.toThrow();
        expect(performance.now() - started).toBeLessThan(3000);
      } finally {
        for (const socket of sockets) socket.destroy();
        server.close();
      }
    });
  });
});
