// @vitest-environment node
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createViteConfig } from '../vite.config';

describe('M1-4: Vite dev server config', () => {
  it('proxies /api to the api dev server on API_PORT', () => {
    const config = createViteConfig({ API_PORT: '4123' });
    expect(config.server?.proxy).toEqual({ '/api': 'http://localhost:4123' });
  });

  it('defaults to localhost only, with the api on port 3000', () => {
    const config = createViteConfig({});
    expect(config.server?.proxy).toEqual({ '/api': 'http://localhost:3000' });
    expect(config.server?.host).toBeUndefined();
    expect(config.server?.allowedHosts).toBeUndefined();
    expect(config.server?.hmr).toBeUndefined();
  });

  it('accepts requests from the HTTPS reverse proxy hostnames, with HMR on its port', () => {
    const config = createViteConfig({
      DEV_HOST: '0.0.0.0',
      DEV_ALLOWED_HOSTS: 'macrofill-dev.lan, macrofill.home.arpa',
      DEV_HMR_CLIENT_PORT: '443',
    });
    expect(config.server?.host).toBe('0.0.0.0');
    expect(config.server?.allowedHosts).toEqual(['macrofill-dev.lan', 'macrofill.home.arpa']);
    expect(config.server?.hmr).toEqual({ clientPort: 443 });
  });

  it('rejects a non-numeric HMR client port', () => {
    expect(() => createViteConfig({ DEV_HMR_CLIENT_PORT: 'https' })).toThrow(/DEV_HMR_CLIENT_PORT/);
  });

  describe('with a running dev server', () => {
    let api: Server;
    let vite: ViteDevServer;
    let viteUrl: string;

    beforeAll(async () => {
      api = createHttpServer((req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ from: 'api', url: req.url }));
      });
      await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
      const apiPort = (api.address() as AddressInfo).port;

      const config = createViteConfig({ API_PORT: String(apiPort) });
      vite = await createServer({
        ...config,
        configFile: false,
        root: fileURLToPath(new URL('..', import.meta.url)),
        logLevel: 'silent',
        server: { ...config.server, port: 0, strictPort: false },
      });
      await vite.listen();
      viteUrl = vite.resolvedUrls?.local[0] ?? '';
    });

    afterAll(async () => {
      await vite.close();
      await new Promise((resolve) => api.close(resolve));
    });

    it('forwards /api requests to the api, so development uses one origin', async () => {
      const res = await fetch(new URL('/api/health?x=1', viteUrl));
      expect(await res.json()).toEqual({ from: 'api', url: '/api/health?x=1' });
    });

    it('serves the app itself', async () => {
      const res = await fetch(viteUrl);
      expect(await res.text()).toContain('<div id="root">');
    });
  });
});
