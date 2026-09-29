import { Hono } from 'hono';

export function createApp() {
  return new Hono().basePath('/api');
}

export type AppType = ReturnType<typeof createApp>;
