import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

export interface AppOptions {
  /** Directory with the built `apps/web`. Production only; in development Vite serves the web app. */
  webDist?: string;
}

function createApiRoutes() {
  return new Hono();
}

export type AppType = ReturnType<typeof createApiRoutes>;

export function createApp(options: AppOptions = {}) {
  const app = new Hono();

  app.route('/api', createApiRoutes());
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
