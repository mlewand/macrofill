import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/db/client';
import { assertSchemaCurrent, pendingMigrations, SchemaBehindError } from '../src/db/migrations';
import { startServer } from '../src/start';
import { createTestDatabase, migrationsDir } from './support/db';

/** A copy of the real migrations plus one later, unapplied migration. */
function migrationsWithOneMore(): string {
  const dir = mkdtempSync(join(tmpdir(), 'macrofill-migrations-'));
  cpSync(migrationsDir, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number; when: number; tag: string }[];
  };
  const last = journal.entries.at(-1)!;
  const tag = `${String(last.idx + 1).padStart(4, '0')}_later`;
  journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1000, tag });
  writeFileSync(journalPath, JSON.stringify(journal));
  writeFileSync(join(dir, `${tag}.sql`), 'CREATE TABLE later (id integer);');
  return dir;
}

describe('M4-9: migrations run only explicitly; the api refuses a schema that is behind', () => {
  let database: Database;
  const tempDirs: string[] = [];

  afterEach(async () => {
    await database.close();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const config = { port: 0, databaseUrl: 'unused', migrationsDir };

  it('a fresh database has every migration pending, and the api refuses to start', async () => {
    database = createTestDatabase();
    expect(await pendingMigrations(database.db, migrationsDir)).toBeGreaterThan(0);
    const serve = vi.fn();
    await expect(startServer(config, database, serve)).rejects.toBeInstanceOf(SchemaBehindError);
    expect(serve).not.toHaveBeenCalled();
  });

  it('checking the schema does not migrate it', async () => {
    database = createTestDatabase();
    await expect(assertSchemaCurrent(database.db, migrationsDir)).rejects.toThrow(
      /pnpm db:migrate/,
    );
    const before = await pendingMigrations(database.db, migrationsDir);
    await expect(assertSchemaCurrent(database.db, migrationsDir)).rejects.toThrow();
    expect(await pendingMigrations(database.db, migrationsDir)).toBe(before);
  });

  it('a fully migrated database starts', async () => {
    database = createTestDatabase();
    await database.migrate(migrationsDir);
    expect(await pendingMigrations(database.db, migrationsDir)).toBe(0);
    const serve = vi.fn(() => 'server');
    await expect(startServer(config, database, serve)).resolves.toBe('server');
    expect(serve).toHaveBeenCalledOnce();
  });

  it('a database one migration short refuses to start', async () => {
    database = createTestDatabase();
    await database.migrate(migrationsDir);
    const newer = migrationsWithOneMore();
    tempDirs.push(newer);
    expect(await pendingMigrations(database.db, newer)).toBe(1);
    const serve = vi.fn();
    await expect(startServer({ ...config, migrationsDir: newer }, database, serve)).rejects.toThrow(
      /1 pending migration/,
    );
    expect(serve).not.toHaveBeenCalled();
  });

  it('migrating twice is a no-op', async () => {
    database = createTestDatabase();
    await database.migrate(migrationsDir);
    await database.migrate(migrationsDir);
    expect(await pendingMigrations(database.db, migrationsDir)).toBe(0);
  });
});
