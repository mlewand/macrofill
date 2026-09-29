import { serveStatic } from '@hono/node-server/serve-static';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Db } from './db/client';
import { stubAuth, type AuthEnv } from './http/auth';
import { catalogRoutes } from './routes/catalog';
import { mealRoutes } from './routes/meals';
import { seedData } from './seed/data';

export interface AppOptions {
  db: Db;
  /** Phase A stub auth acts as this seeded user. Defaults to the first seed user. */
  stubUsername?: string;
  /** Directory with the built `apps/web`. Production only; in development Vite serves the web app. */
  webDist?: string;
}

function createApiRoutes(db: Db, stubUsername: string) {
  return new Hono<AuthEnv>()
    .use(stubAuth(db, stubUsername))
    .route('/', catalogRoutes(db))
    .route('/', mealRoutes(db));
}

export type AppType = ReturnType<typeof createApiRoutes>;

export function createApp(options: AppOptions) {
  const app = new Hono();

  // Malformed JSON bodies (M4-4) come here as 400 HTTPExceptions from the validator.
  app.onError((error, c) => {
    if (error instanceof HTTPException && error.status === 400) {
      return c.json({ error: 'invalid_json' }, 400);
    }
    if (error instanceof HTTPException) return error.getResponse();
    console.error(error);
    return c.json({ error: 'internal' }, 500);
  });

  // M4-8: outside the api routes, so auth (M4-2) never wraps it. The Docker healthcheck calls it.
  app.get('/api/health', async (c) => {
    try {
      await options.db.execute(sql`select 1`);
      return c.json({ status: 'ok' });
    } catch {
      return c.json({ status: 'unavailable' }, 503);
    }
  });

  app.route(
    '/api',
    createApiRoutes(options.db, options.stubUsername ?? seedData.users[0]!.user.username),
  );
  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

  if (options.webDist !== undefined) {
    serveWeb(app, options.webDist);
  }

  return app;
}

// Files that must be revalidated on every load, so an installed PWA picks up a new version.
const noCacheFiles = new Set(['sw.js', 'registerSW.js', 'manifest.webmanifest']);

function cacheControlFor(path: string, contentType: string | null): string | undefined {
  const file = path.split('/').pop() ?? '';
  if (noCacheFiles.has(file) || contentType?.startsWith('text/html') === true) return 'no-cache';
  // Vite puts content-hashed files in assets/.
  if (path.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  return undefined;
}

function serveWeb(app: Hono, root: string) {
  app.use('*', async (c, next) => {
    await next();
    if (!c.res.ok || c.req.path.startsWith('/api/')) return;
    const cacheControl = cacheControlFor(c.req.path, c.res.headers.get('content-type'));
    if (cacheControl !== undefined) c.res.headers.set('Cache-Control', cacheControl);
  });

  app.use('*', serveStatic({ root }));

  // Client-side routes fall back to index.html. Paths with a file extension
  // are missing files, so they stay 404.
  app.get(
    '*',
    async (c, next) => {
      if (/\.[^/]+$/.test(c.req.path)) return c.notFound();
      await next();
    },
    serveStatic({ root, path: 'index.html' }),
  );
}
