import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

describe('M1-5: api serves the built web app', () => {
  let webDist: string;

  beforeAll(() => {
    webDist = mkdtempSync(join(tmpdir(), 'macrofill-web-'));
    mkdirSync(join(webDist, 'assets'));
    writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>index</title>');
    writeFileSync(join(webDist, 'assets', 'index-abc123.js'), 'console.log(1);');
    writeFileSync(join(webDist, 'sw.js'), 'self.addEventListener("fetch", () => {});');
    writeFileSync(join(webDist, 'manifest.webmanifest'), '{}');
  });

  afterAll(() => {
    rmSync(webDist, { recursive: true, force: true });
  });

  const app = () => createApp({ webDist });

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

  it('does not fall back to index.html for unknown API routes', async () => {
    const res = await app().request('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('<title>index</title>');
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
    const res = await createApp().request('/');
    expect(res.status).toBe(404);
  });
});
