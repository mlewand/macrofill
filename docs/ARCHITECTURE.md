# Architecture

pnpm monorepo. `apps/*` are deployable; `packages/*` are libraries imported by apps and never deployed on their own.

```
apps/web ──► packages/scale ──► packages/domain
    └──────────────────────────► packages/domain
apps/api ──────────────────────► packages/domain
```

| Path | Role | May import |
|---|---|---|
| `packages/domain` | Pure TypeScript, no I/O. Entity types, zod schemas (the API contract), macro calculation, weight tracker, usage event catalog. | only `zod` |
| `packages/scale` | Scale abstraction: `ScaleDriver` interface, `HuajunDriver` (adapter over `@mlewand/huajun-ble-scale`), `MockScaleDriver`, `ReplayScaleDriver`, test builder, session recorder. | `domain`, `@mlewand/huajun-ble-scale` (its Capacitor entry needs `@capacitor-community/bluetooth-le` and `@capacitor/core` installed) |
| `apps/web` | React + Vite PWA. UI, i18n, IndexedDB session state and save outbox. The only place that talks to the scale. | `domain`, `scale`, types from `api` (for the `hc` client) |
| `apps/api` | Hono + Drizzle + Postgres. Auth, owner-scoped repositories, persistence. In production it also serves the built `apps/web` (one container, one origin). | `domain` |

## Rules

- `domain` has no I/O, no clock and no randomness. Time and IDs come in as arguments. Its tsconfig sets `"lib": ["ES2022"]` and `"types": []`, so any DOM or Node API fails typecheck.
- Byte decoding lives in `@mlewand/huajun-ble-scale`. `packages/scale` maps the library's readings to domain types and never parses frames itself; parser fixes go to the library.
- `web` imports from `api` with `import type` only. `api` never imports `scale`.
- HTTP handlers are thin: validate with `domain` zod schemas, resolve the user, call a service. All database access goes through repositories scoped by `ownerId`.
- ESLint `no-restricted-imports` enforces the import rules per package; CI fails on violations.

## Tests

| Package | Tests | Line coverage |
|---|---|---|
| `domain` | Unit and property-based (fast-check) | ≥ 90% |
| `scale` | Adapter mapping, mock and replay drivers | ≥ 70% |
| `api` | Integration tests in-process against PGlite; CI also against the host's Postgres version | ≥ 70% |
| `web` | Component tests (Testing Library); Playwright e2e with `MockScaleDriver` | ≥ 70% |
