import type { AppType } from '@macrofill/api';
import { hc } from 'hono/client';

/** Typed client for the api, on the same origin (Vite proxies `/api` in development). */
export function createApiClient(baseUrl = '/api') {
  return hc<AppType>(baseUrl);
}

export type ApiClient = ReturnType<typeof createApiClient>;
