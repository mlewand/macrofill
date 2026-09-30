# Macrofill

Diet tracking PWA. It logs a multi-ingredient meal while you make it, using a Bluetooth kitchen scale, and tracks daily macros against targets. Android Chrome, mobile only.

- Requirements and acceptance criteria: [`docs/requirements.md`](docs/requirements.md)
- Package roles and import rules: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Working rules for coding agents: [`AGENTS.md`](AGENTS.md)

## Prerequisites

- Node.js 24, version 24.15 or later (see `.nvmrc` and `engines`)
- pnpm, via Corepack: `corepack enable`. The version comes from `packageManager` in `package.json`.
- Docker with Compose, for the local Postgres and the production image

## First-time setup

```sh
corepack enable
pnpm install
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open http://localhost:5173.

- `pnpm db:up` starts Postgres 17 in Docker Compose on `127.0.0.1:5432`, and `.env.example` already points `DATABASE_URL` at it. To use an existing Postgres server instead, give the app its own database and role there and change only `DATABASE_URL`.
- `pnpm db:migrate` applies the Drizzle migrations in `apps/api/drizzle`. It's the only way migrations run: the api refuses to start while the schema is behind.
- `pnpm db:seed` loads the recipes, ingredient classes, products and users from `apps/api/src/seed/data.ts`. Running it again is safe; it updates rows in place. Daily targets are set there too (unset means not tracked).
- After changing `apps/api/src/db/schema.ts`, generate a migration with `pnpm -F @macrofill/api db:generate`, then run `pnpm db:migrate`.

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
| `pnpm test:e2e` | Playwright on phone and tablet viewports (portrait), against the production build served by the api |
| `pnpm format` | Format with Prettier |

Before the first `pnpm test:e2e`, install the browser once: `pnpm --filter @macrofill/web exec playwright install --with-deps chromium`. The e2e tests use **their own database**, never the dev one: `DATABASE_URL`'s database with `_e2e` added (`macrofill_e2e`), on the same server. Every run creates it if it's missing, wipes it, migrates and seeds it, so runs start from the same state and your dev data stays as it is. Only `pnpm db:up` is needed first. To use another database, set `E2E_DATABASE_URL` (see `.env.example`). The reset refuses any database whose name doesn't end in `_e2e`. On a Postgres where the app's role can't create databases, create the `_e2e` database once yourself, owned by that role. The Vitest API tests need no database; they use PGlite in-process.

Running a subset:

- by criterion ID: `pnpm test -t 'M3-6'`, or `pnpm test:e2e -g 'M6-8'`
- one project (`domain`, `scale`, `web`, `api`, or `repo` for the root `tests/`): `pnpm test --project domain`
- one file: `pnpm test packages/domain/test/tsconfig.test.ts`

CI (GitHub Actions) runs lint, typecheck, the Vitest tests, the e2e tests and a production image build with a smoke test (`tooling/ci/image-smoke.sh`) on every push.

## Production deploy

One Docker image: the api serves the built web app, on one origin. It runs on the LAN server behind the Caddy HTTPS reverse proxy, next to the host's existing Postgres container.

**LAN only for now:** there's no login yet; every request acts as the seeded user. Don't forward the port or publish the hostname outside your network.

You need Docker with Compose v2 and git on the server, the Postgres container (CI tests against Postgres 17), and Caddy.

1. **Create the database and its role** on the host Postgres. `-U` is the container's superuser: `docker exec <pg-container> printenv POSTGRES_USER` shows it, and it's `postgres` if that prints nothing.

   ```sh
   docker exec -it <pg-container> psql -U <superuser> -d postgres \
     -c "CREATE ROLE macrofill LOGIN PASSWORD '<password>';" \
     -c "CREATE DATABASE macrofill OWNER macrofill;"
   ```

2. **Find the Postgres container's Docker network:**

   ```sh
   docker inspect <pg-container> --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}'
   ```

3. **Clone the repo and create `.env`** next to `compose.prod.yml`. URL-encode special characters in the password (`@` → `%40`, `/` → `%2F`). `APP_PORT` is the port on the server; inside the container the app always listens on 3000.

   ```sh
   git clone git@github.com:mlewand/macrofill.git && cd macrofill
   cat > .env <<'ENV'
   DATABASE_URL=postgres://macrofill:<password>@<pg-container>:5432/macrofill
   POSTGRES_NETWORK=<network from step 2>
   APP_PORT=3000
   ENV
   ```

4. **Deploy:**

   ```sh
   ./deploy.sh
   ```

   It builds the image, applies migrations, loads the seed data (safe to repeat), starts the container and waits until its health check passes, then prints `Macrofill is up and healthy.` If something fails it stops there, with a non-zero exit code and the reason; if the container doesn't turn healthy it prints the recent logs.

5. **Point a Caddy site at the server:**

   ```
   <prod-hostname> {
     reverse_proxy <lan-server-ip>:<APP_PORT>
   }
   ```

6. On the phone, open `https://<prod-hostname>` in Chrome, then ⋮ → **Install app**.

**Updating:** `git pull && ./deploy.sh`.

**Daily targets and the catalog come from the seed file:** every deploy resets them to `apps/api/src/seed/data.ts`. To change your targets or add a product, edit that file, commit it, and deploy. Edits made directly in the database are overwritten by the next deploy. Logged meals are never touched.

The container's healthcheck calls `/api/health`, which checks the database connection. `docker compose -f compose.prod.yml ps` shows the status, and `docker compose -f compose.prod.yml logs app` shows the logs. "Database schema is behind" means migrations haven't run; `deploy.sh` runs them. Migrations run only through that explicit step: an app that's newer than the database schema refuses to start. Include the `macrofill` database in the host's `pg_dump` backups.
