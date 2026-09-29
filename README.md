# Macrofill

Diet tracking PWA. It logs a multi-ingredient meal while you make it, using a Bluetooth kitchen scale, and tracks daily macros against targets. Android Chrome, mobile only.

- Requirements and acceptance criteria: [`docs/requirements.md`](docs/requirements.md)
- Package roles and import rules: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Working rules for coding agents: [`AGENTS.md`](AGENTS.md)

## Prerequisites

- Node.js 24 (see `.nvmrc`)
- pnpm, via Corepack: `corepack enable`. The version comes from `packageManager` in `package.json`.
- Docker with Compose, for the local Postgres and the production image

## First-time setup

```sh
corepack enable
pnpm install
cp .env.example .env
pnpm db:up
pnpm dev
```

Open http://localhost:5173.

- `pnpm db:up` starts Postgres 17 in Docker Compose on `127.0.0.1:5432`, and `.env.example` already points `DATABASE_URL` at it. To use an existing Postgres server instead, give the app its own database and role there and change only `DATABASE_URL`.
- Migrations (`pnpm db:migrate`) and seed data (`pnpm db:seed`) don't exist yet. They'll run here, after `pnpm db:up`.

## Daily development

`pnpm dev` runs both apps on the host:

- web: Vite on port 5173. It proxies `/api` to the api, so the browser sees one origin, like in production.
- api: Hono on `API_PORT` (3000), restarted on changes.

Both read the root `.env`.

### Testing on the phone over HTTPS

Web Bluetooth and PWA installation need HTTPS. On the LAN, a Caddy reverse proxy on another machine provides it.

1. In `.env`, let Vite accept requests from the proxy:

   ```sh
   DEV_HOST=0.0.0.0
   DEV_ALLOWED_HOSTS=macrofill-dev.example.lan   # the hostname Caddy serves
   DEV_HMR_CLIENT_PORT=443                       # HMR goes through the proxy too
   ```

2. In the Caddyfile, point a site at the dev machine's Vite port. Caddy passes WebSockets through by default, so HMR works without extra settings.

   ```
   macrofill-dev.example.lan {
     reverse_proxy <dev-machine-ip>:5173
   }
   ```

3. Restart `pnpm dev` and open `https://macrofill-dev.example.lan` in Chrome on the phone.

## Tests and checks

| Command | What it runs |
|---|---|
| `pnpm lint` | ESLint (including the package import rules) and `prettier --check` |
| `pnpm typecheck` | `tsc` for every package |
| `pnpm test` | Vitest: unit, component and API integration tests |
| `pnpm test:e2e` | Playwright on a phone viewport, against the production build served by the api |
| `pnpm format` | Format with Prettier |

Before the first `pnpm test:e2e`, install the browser once: `pnpm --filter @macrofill/web exec playwright install --with-deps chromium`.

Running a subset:

- by criterion ID: `pnpm test -t 'M3-6'`, or `pnpm test:e2e -g 'M6-8'`
- one project (`domain`, `scale`, `web`, `api`, or `repo` for the root `tests/`): `pnpm test --project domain`
- one file: `pnpm test packages/domain/test/tsconfig.test.ts`

CI (GitHub Actions) runs lint, typecheck, the Vitest tests, the e2e tests and a production image build on every push.

## Production deploy

One Docker image: the api serves the built web app, on one origin. It runs on the LAN server behind the Caddy HTTPS reverse proxy, next to the host's existing Postgres.

1. On the host's Postgres, create a database and a role that owns only that database.
2. On the LAN server, check out the repo and create a `.env` next to `compose.prod.yml`:

   ```sh
   DATABASE_URL=postgres://macrofill:<password>@<postgres-container>:5432/macrofill
   POSTGRES_NETWORK=<external Docker network of the Postgres container>
   APP_PORT=3000
   ```

3. Build and start:

   ```sh
   docker compose -f compose.prod.yml up -d --build
   ```

4. Point a Caddy site at `<lan-server-ip>:3000`.

Updating means pulling the repo and running the same command again. Migrations will be a separate, explicit step before the restart once they exist.
