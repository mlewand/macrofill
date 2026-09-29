import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type UserConfig } from 'vite';

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
    plugins: [react()],
    server: {
      proxy: { '/api': `http://localhost:${apiPort}` },
      ...(env.DEV_HOST ? { host: env.DEV_HOST } : {}),
      ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
      ...(hmrClientPort === undefined ? {} : { hmr: { clientPort: hmrClientPort } }),
    },
  };
}

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => createViteConfig(loadEnv(mode, repoRoot, '')));
