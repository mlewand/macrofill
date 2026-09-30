import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type UserConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

type Env = Record<string, string | undefined>;

function port(env: Env, name: string): number | undefined {
  const value = env[name];
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`${name} must be a port number, got "${value}"`);
  }
  return n;
}

/**
 * Dev server settings come from the repo root `.env` (see `.env.example`):
 * - API_PORT: where the api dev server listens; `/api` is proxied there (one origin, like production).
 * - DEV_HOST: interface to listen on; set `0.0.0.0` when the HTTPS reverse proxy runs on another machine.
 * - DEV_ALLOWED_HOSTS: comma-separated hostnames the reverse proxy uses.
 * - DEV_HMR_CLIENT_PORT: the port the browser sees for HMR, `443` behind the HTTPS proxy.
 */
export function createViteConfig(env: Env): UserConfig {
  const apiPort = port(env, 'API_PORT') ?? 3000;
  const hmrClientPort = port(env, 'DEV_HMR_CLIENT_PORT');
  const allowedHosts = (env.DEV_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter((h) => h !== '');

  return {
    plugins: [react(), pwa()],
    server: {
      proxy: { '/api': `http://localhost:${apiPort}` },
      ...(env.DEV_HOST ? { host: env.DEV_HOST } : {}),
      ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
      ...(hmrClientPort === undefined ? {} : { hmr: { clientPort: hmrClientPort } }),
    },
  };
}

/**
 * M7-7: installable PWA. The service worker precaches the built app and falls back to index.html
 * for navigations, but never caches or answers `/api`: the server is the source of truth.
 * The api serves sw.js and the manifest with `Cache-Control: no-cache` (M1-5), so installed
 * copies pick up new versions.
 */
function pwa() {
  return VitePWA({
    // The new service worker takes over at once, but nothing reloads the page: registerSW.js
    // only registers, so an in-progress meal (kept in memory) survives a deploy and the next
    // load gets the new version. e2e/pwa.spec.ts checks this.
    registerType: 'autoUpdate',
    includeAssets: ['icons/apple-touch-icon.png'],
    manifest: {
      name: 'Macrofill',
      short_name: 'Macrofill',
      description: 'Log meals while you make them and track daily macros.',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#ffffff',
      theme_color: '#2f6f3e',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/api(\/|$)/],
    },
  });
}

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => createViteConfig(loadEnv(mode, repoRoot, '')));
