# AGENTS.md

Diet tracking app (working name Macrofill). It logs a multi-ingredient meal while you make it, using a Bluetooth kitchen scale, and tracks daily macros against targets. PWA for Android Chrome, pnpm monorepo, TypeScript.

Read before any work:

- `docs/requirements.md`: requirements, acceptance criteria (IDs like `M3-6`) and phases. The source of truth.
- `docs/ARCHITECTURE.md`: package roles and import rules.
- `docs/TODO.md`: deferred items. Don't implement them.

Current phase: **B**, in progress since 2026-09-30. Phase A's exit was confirmed on 2026-09-30: a real meal logged with Direct Entry on the phone, visible on the tablet, on the production box. Update this line when a phase's exit criteria are met.

## Starting Phase B

Handover from Phase A. Delete each point once it's resolved, and this section once it's empty.

- **Library ready.** `@mlewand/huajun-ble-scale@0.0.4` (npm) has everything Phase B and C need: `Reading.receivedAtMonotonic` (use it for `ScaleReading.timestamp`), `toReading` for replays, and `CapacitorTransport` `deviceId` reconnect. See `docs/TODO.md`. It isn't a dependency of `packages/scale` yet. If pnpm's `minimumReleaseAge` still holds it back when it's needed, depend on the library's GitHub release tag instead (approved), with a `docs/TODO.md` item to switch back to the npm package.
- **Decide first, and state the choice in the first PR that needs it:**
  - **How e2e injects `MockScaleDriver`.** e2e runs against the *production* build served by the api (M1-5). The requirements say the mock is injected in the test build. Choose between a hook the real bundle honours and a separate e2e build, and ask if the choice changes what e2e really tests.
- **Verified on real hardware so far:** Web Bluetooth readings from the scale in Chrome on Android over HTTPS; automatic reconnect with the library's new API, but only in a native Capacitor Android build (M6-6 is Phase C).
- **M7-6's remaining part:** the live weight must be at least 48 px. Extend `apps/web/e2e/layout.spec.ts` when Scale Mode exists.

## How to work

- Work in the current phase only (A, B, C in the requirements). Don't implement criteria from a later phase, `TODO.md` or Future stages.
- One milestone, or one coherent group of criteria, per pull request (see Git workflow).
- Tests first: write failing tests for the criteria you're implementing, then the code. Put the criterion ID in the test name, e.g. `it('M3-6: negative step asks for correction', ...)`.
- Never change requirements, criteria, `docs/ARCHITECTURE.md` or `docs/TODO.md` silently. If a criterion is ambiguous, contradicts another, or looks wrong, stop and ask. If it has to change, propose the edit and say why.
- Never weaken tests, coverage thresholds or lint rules to get a green build.
- **Every business logic bug that's discovered gets a regression test**, whether it was found in review, testing or use. The test references the pull request or GitHub issue where the bug was found: add `(regression: #<number>)` at the end of the test name, after the criterion ID, e.g. `it('M4-6: a retry naming a different entry is a conflict (regression: #11)', ...)`. Check that the test fails without the fix and passes with it. A test that passes either way doesn't guard anything. `pnpm test -t 'regression: #'` runs them all.
- Before finishing: `pnpm lint`, `pnpm typecheck` and `pnpm test` pass from the repo root.
- Keep `README.md` current when setup, commands or deployment change.
- Commit messages name the criterion IDs they cover.

## Git workflow

- Never commit to `master` directly. Work on a dedicated branch and merge through a pull request.
- Commit as you go: one commit per small, self-contained change, where possible.
- Open a PR once the branch holds a deliverable. Keep PRs reasonably sized. If the work is bigger, split it into stacked PRs (each branch based on the previous one) and name the base PR in the description.
- PR descriptions list the criterion IDs they cover.
- Do branch work in a `git worktree`, and keep the main checkout on `master`: it may be serving the dev server, and switching branches under a running Vite can break its config reload. Pull `master` there after merges.
- A PR is ready when CI is green. The maintainer asks GitHub Copilot to review it. Address every finding, including points that appear only in the review summary; answer those with a PR comment. Reply on inline threads with the fixing commit and resolve them. Check a finding before fixing it, and if it doesn't hold, say why, with evidence.

## Conventions

- TypeScript `strict` everywhere.
- Dependencies respect pnpm's `minimumReleaseAge` (brand-new releases are held back). Don't add `minimumReleaseAgeExclude` entries; use a version range that allows an older release. pnpm adds such entries on its own when you ask for a version that's too new, so check `pnpm-workspace.yaml` after adding dependencies.
- The zod schemas in `packages/domain` are the API contract. Web and api import them and never redefine the same shapes.
- `packages/domain` has no I/O, no clock and no randomness. Pass time and IDs in.
- Scale byte decoding lives in `@mlewand/huajun-ble-scale`. If the library lacks something, report it instead of reimplementing it; the change belongs in the library.
- Every user-owned table has `ownerId`, and all queries go through the owner-scoped repositories.
- Entity IDs are UUIDs generated by the client, so saves can be retried safely.
- Schema changes are Drizzle migration files, generated from `apps/api/src/db/schema.ts` with `pnpm -F @macrofill/api db:generate`. Never edit a migration that has been merged. Migrations run only through the explicit migrate command.
- All UI text goes through the i18n catalog (English only for now). Number inputs accept both `3,2` and `3.2`.
- `test_data/nutritional_example.json` holds real per-100 g label values for candidate seed products (sandwich and curd recipes). Its field names differ from the domain `NutritionValues` (`kcals`, `carbohydrates`, `sugar`, `saturatedFat`), so map them. It has no fibre, and some products also lack other values (`null`). Missing values must load as unknown, never 0 (M2-3).

## Scale and hardware

- The real scale isn't available in CI or to you. Use `MockScaleDriver` with the `scaleScript()` builder.
- Web Bluetooth needs HTTPS and a user gesture for the first connect. On the web the device chooser lists all devices (`showAllDevices: true`) because Chrome's name filter doesn't match this scale. That is expected.

## Commands

Root scripts; keep this list in sync with `package.json`. Rows marked *(pending)* don't exist yet.

| Command | Purpose |
|---|---|
| `pnpm dev` | Run web (Vite, proxies `/api`) and api on the host; settings in `.env` (copy `.env.example`) |
| `pnpm db:up` | Start the local Postgres 17 in Docker Compose |
| `pnpm build` | Build web and api (`apps/*/dist`); the `Dockerfile` runs it |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL`; the api refuses to start while any are pending |
| `pnpm db:seed` | Load seed data from `apps/api/src/seed/data.ts` (idempotent) |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Checks that must pass before finishing. `lint` runs ESLint and `prettier --check` |
| `pnpm format` | Format with Prettier |
| `pnpm test:e2e` | Playwright tests on phone and tablet viewports (portrait), against the production build served by the api. Uses its own database (`DATABASE_URL` + `_e2e`, or `E2E_DATABASE_URL`), wiped and reseeded each run |

Running a subset of tests (Vitest projects are named `domain`, `scale`, `web`, `api` and `repo` for the root `tests/`):

- by criterion ID: `pnpm test -t 'M3-6'`, or `pnpm test:e2e -g 'M6-8'`
- one project: `pnpm test --project domain`, or `pnpm -F @macrofill/domain test`
- one file: `pnpm test packages/domain/test/tsconfig.test.ts`

## Saving coding agent information

When feasible `AGENTS.md` should be preferred for storing information over `CLAUDE.md`.

`Claude.md` should be used only for truly claude specific instructions that are not useful for other LLM harness.
