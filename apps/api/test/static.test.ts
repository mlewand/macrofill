import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { Database } from '../src/db/client';
import { seed } from '../src/seed/seed';
import { createMigratedTestDatabase } from './support/db';

describe('M1-5: api serves the built web app', () => {
  let webDist: string;
  let database: Database;

  beforeAll(async () => {
    // Unknown /api paths pass the stub auth first, which needs the seeded user.
    database = await createMigratedTestDatabase();
    await seed(database.db);
    webDist = mkdtempSync(join(tmpdir(), 'macrofill-web-'));
    mkdirSync(join(webDist, 'assets'));
    writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>index</title>');
    writeFileSync(join(webDist, 'assets', 'index-abc123.js'), 'console.log(1);');
    writeFileSync(join(webDist, 'sw.js'), 'self.addEventListener("fetch", () => {});');
    writeFileSync(join(webDist, 'manifest.webmanifest'), '{}');
  });

  afterAll(async () => {
    rmSync(webDist, { recursive: true, force: true });
    await database.close();
  });

  const app = () => createApp({ db: database.db, webDist });

  it('serves index.html at the root', async () => {
    const res = await app().request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>index</title>');
  });

  it('serves built assets', async () => {
    const res = await app().request('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('console.log(1);');
  });

  it('falls back to index.html for client-side routes', async () => {
    const res = await app().request('/today');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toContain('<title>index</title>');
  });

  it.each(['/api', '/api/', '/api/does-not-exist'])(
    'does not fall back to index.html for unknown API route %s',
    async (path) => {
      const res = await app().request(path);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
    },
  );

  it('falls back to index.html for app routes that only start with "api"', async () => {
    const res = await app().request('/apix');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>index</title>');
  });

  it('serves the service worker with Cache-Control: no-cache', async () => {
    const res = await app().request('/sw.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it.each(['/', '/today', '/manifest.webmanifest'])(
    'serves %s with Cache-Control: no-cache, so new versions are picked up',
    async (path) => {
      const res = await app().request(path);
      expect(res.headers.get('cache-control')).toBe('no-cache');
    },
  );

  it('serves hashed assets as immutable', async () => {
    const res = await app().request('/assets/index-abc123.js');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('returns 404 for a missing asset instead of index.html', async () => {
    const res = await app().request('/assets/missing.js');
    expect(res.status).toBe(404);
  });

  it('serves no static files when no web build is configured', async () => {
    const res = await createApp({ db: database.db }).request('/');
    expect(res.status).toBe(404);
  });
});
