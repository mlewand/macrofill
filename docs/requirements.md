# Diet tracking app

Working code name: **Diet Tracking App** (Macrofill)

Status: MVP0 is done (Phases A to C), and so is Phase D (see Phases). Future stages are listed so the design leaves room for them. Don't implement them before a phase takes them in.

# Problem

I need to hit my protein/fat/carbs norm daily. It's troublesome.

- Value proposition (draft): for people who already weigh their food, the app logs a multi-ingredient meal while you make it. Put the bowl on any cheap Bluetooth scale, add ingredients, tap "next". No taring, no typing grams, no searching the database for the meal you ate yesterday.
- Differentiators vs existing scale+app bundles (Etekcity/VeSync, Fitdays, Arboleaf):
  - works with any cheap BLE scale, not a vendor-locked one
  - no taring between ingredients
  - prediction from recipes and history for repeated meals
  - local (Polish) product data
- Primary user for now: me. Fine if I'm the only user.

# Glossary

- Macro elements - a set of nutrition properties relevant for a given food product. Those are usually presented as nutrition table in European Union.
- Meal input method - the way a user enters a meal. Three methods: **Scale Mode** (smart scale), **Vision Mode** (photo-based, future), **Direct Entry** (manual input).
- Capture session - one run of a meal input method, from picking a recipe to saving the meal.
- Recipe - an ordered list of steps. Each step names an ingredient class. No quantities (the scale provides them), no cooking instructions.
- Ingredient class - a generic ingredient like "Curd", "Cheese", "Milk", optionally more specific like "3,2% Milk", "White Cheese".
- Product - a concrete product (brand + name) with nutrition values per 100 g. Belongs to one ingredient class.
- Prepared meal - the result of a capture session: products used and their weights.
- Consumption entry - what the user actually ate, pointing to a prepared meal. In MVP0 always the whole prepared meal.
- Daily targets - expected daily intake of protein, fat, carbs, fibre, kcal. Each target is optional; a nutrient without a target isn't tracked against one.

# MVP0 scope

- Goals
  - be able to make one of two predefined/hardcoded meals (curd, wholegrain bread)
  - be able to use bluetooth kitchen scale to weigh the ingredients (Scale Mode)
  - Direct Entry as a fallback without the scale
  - very basic macro tracking: daily totals vs daily targets
  - data synchronized across my devices (phone, tablet) via a tiny backend
  - well tested: automated tests at every layer from day one (see Testing strategy)
- Accepted shortcuts
  - users provisioned from configuration/seed, no sign-up UI; login with username + password. Data model and auth are multi-user from day 0 (see Data model, Backend & sync)
  - one user per device: each phone or tablet is used by one person. The server keeps users apart (M4-1 to M4-3), and refuses a save that names another user than the session's. On the device, what's kept for a reload or offline (the Direct Entry draft, the save outbox) is tied to the user who saved it, as a best-effort guard. Switching users on one device, also across tabs or with browser storage blocked, isn't an MVP0 scenario: gaps found there are tracked as issues, not treated as blockers
  - daily targets defined in configuration, no GUI
  - recipes, ingredient classes and products come from seed files in the repo, no GUI to edit them. Phase D lifts this for products: they're added in the app
  - Android Chrome only
  - online-first sync (see Backend & sync)
- Must implement support for my bluetooth kitchen scale (implement a driver for it). There should be a base abstraction for the kitchen scale so that any new models can be added easily later on.

# Platform

- Target platform PWA at first. I'll migrate to Capacitor down the road when support for iOS is needed.
- Mobile only (phone, tablet). Desktop is not a target.
- Android Chrome. My scale exposes a GATT notify characteristic, which Web Bluetooth supports without flags on Android. iOS Safari has no Web Bluetooth, hence Capacitor later.
- Web Bluetooth requires HTTPS. Dev and self-hosting go through a reverse proxy with HTTPS on my LAN.
- Connecting to the scale requires a user gesture (a "Connect scale" button).

# Architecture

- pnpm monorepo, TypeScript everywhere:
  - `packages/domain` - pure TS, no I/O: types, zod schemas, macro calculation, weight tracker (turns readings + user events into step amounts). Most logic and most tests live here.
  - `packages/scale` - `ScaleDriver` interface, `HuajunDriver` (adapter over `@mlewand/huajun-ble-scale`, which does all byte decoding), `MockScaleDriver`, `ReplayScaleDriver`, test builder, session recorder.
  - `apps/web` - PWA.
  - `apps/api` - tiny backend. In production it also serves the built `apps/web` (one container, one origin).
- Frontend: React + Vite + vite-plugin-pwa.
- Schemas: zod, shared between web and api as the API contract.
- Backend: Hono + Drizzle + Postgres. Typed client via Hono `hc`. Tests use PGlite (Postgres compiled to WASM, in-process).
- Thin HTTP layer: handlers only validate input (zod), resolve the user and call services. Logic lives in `packages/domain` and a service layer, so the framework stays replaceable.
- Package roles, allowed imports and coverage thresholds are in `ARCHITECTURE.md`. Boundaries are enforced by tsconfig and ESLint (M1-7).
- This file is the requirements source for AI coding agents.

# Data model

- Ownership: every user-owned entity (PreparedMeal, ConsumptionEntry, ScaleRecording, DailyTargets, UsageEvent) has `ownerId`. Curated content (IngredientClass, Recipe) and all Products are global. From Phase D, products are one store shared by all users: a product added by one user is visible to everyone, and there are no per-user products. All data access goes through a repository layer. Queries for user-owned entities are scoped by the current user; queries for global content (ingredient classes, recipes, products) aren't. No query bypasses the repository layer. Authentication is the one exception to user scoping: it finds the user by username or session before there is one.
- User: id, username, password hash (argon2id), timezone (IANA name, e.g. `Europe/Warsaw`; used by M2-5, M7-1).
- NutritionValues (per 100 g): energy kcal, fat, saturates, carbs, sugars, protein, salt (full EU label set), fibre (EU labels don't always have it). UI shows only protein/fat/carbs/fibre/kcal for now.
  - Any value missing from a product's label or source (most often fibre, but e.g. saturates, sugars or salt too) is stored as unknown, never as 0. A meal or day total of a nutrient that includes an unknown value is shown as "unknown"; the other nutrients' totals are unaffected.
- IngredientClass: id (stable slug, e.g. `curd`), name (LocalizedText).
- Product: id, ingredientClassId, name (plain string, as on the package), brand?, nutrition per 100 g, source (`seed`, `manual`, or the lookup provider it came from), sourceRef? (the provider's own reference), barcode?, createdBy?.
  - barcode: unique across the store, stored in one 13-digit form: EAN-13 as is, UPC-A and EAN-8 left-padded with zeros. Seed products may have none.
  - createdBy: the user who added the product. It's kept for the maintainer only: the API and UI never show it. Deleting that user clears it, and the product stays.
- Recipe: id, name (LocalizedText), steps: ordered list of { id, ingredientClassId, defaultProductId? }.
- PreparedMeal: id, recipeId?, inputMethod (`scale` | `vision` | `direct`), startedAt, finishedAt, items: a discriminated union on `skipped` — `{ stepId?, skipped: true }` for a skipped step, or `{ stepId?, skipped: false, productId, grams, weightSource ('scale' | 'manual') }` otherwise. `productId` and `grams` don't exist on a skipped item.
  - Item grams are ≥ 0. Negative items (net removal) are deferred.
  - Future: total cooked weight, for batch dishes (Thermomix) where water evaporates.
- ConsumptionEntry: id, preparedMealId, eatenAt, portion. MVP0 creates it automatically with portion = whole meal.
  - Future: eat just part of a meal (e.g. shared with others), as grams of cooked weight or a fraction.
- DailyTargets: per user; protein, fat, carbs, fibre, kcal, each optional (unset means not tracked, never 0). From configuration/seed in MVP0.
- UsageEvent: id, ownerId, clientSessionId, name, props (jsonb), occurredAt, appVersion. See Usage data.
- ScaleRecording: capture session id, driver id, frames { timestamp, raw payload, parsed reading }, user events (next, skip, manual override, undo).

# Cookbook database

- Realistically I need two meals for testing (curd and wholegrain bread).
- Each meal has steps, each requiring an ingredient class. The user picks the concrete product at that step.
- Generic class-level macros are too inaccurate (e.g. lean vs full-fat curd differ several times over in fat). The product picker shows products of the step's ingredient class, most recently used choices prioritized.
- MVP0: recipes, ingredient classes and products are seed files in the repo (JSON/TS), loaded into the backend DB.
- Phase D: users add products in the app, by typing the label values or by barcode lookup, into the shared store (see Data model). The seed file's products only initialize an empty product store. Once the store holds products, seeding doesn't load products again, and editing the seed file no longer changes them. Products from the seed keep source `seed`.
- Seed recipes:
  - Sandwich: wholegrain bread → cream cheese → cheese → ham
  - Curd: curd → milk → cucumber → ham → radish
- Initial products and their label values are defined during implementation.
- In the future:
  - In the production quality, I expect this to contain a vast meal recipe database.
  - User should be able to add his own recipes.
  - Adding a product from a photo of its nutrition label.
  - Product prediction from history beyond "most recent first".

# Meal input methods

- This is the process for user to make a meal. The procedure should be as frictionless as possible.
- Ultimately more than one meal input method will be implemented by the app. MVP0 ships Scale Mode and Direct Entry.
- All methods allow the user to modify and proceed manually. For example, if the user finds that the weight yielded by the kitchen scale is invalid, the user can input the weight manually.

## Scale Mode (MVP0)

- Flow
  1. Pick a recipe.
  2. Connect the scale (button, user gesture).
  3. For each step: show the ingredient class, the product picker, and the live weight in large digits. User adds the ingredient (in as many spoonfuls/packs as needed), then taps Next.
  4. User can skip a step.
  5. User can manually correct the weight of any step whenever they want, also when the reading is valid, including in the summary before Save.
  6. User can undo the last step.
  7. Summary with the meal's macros, then Save. Saving creates the PreparedMeal and its ConsumptionEntry.
- Weight tracking rules
  - No taring between ingredients. The app keeps a running weight. A step's amount = reading at this Next minus reading at the previous Next.
  - The reading at Next is the last stable value, or the app waits up to ~1.5 s for the reading to stabilize. The value is shown for confirmation. (The finger on the phone and a spoon resting on the bowl make the raw value at tap time unreliable.)
  - Use the scale's stable flag when the driver provides it; otherwise software stability detection (readings within ±1 g for 1000 ms, both configurable).
  - A step amount below 0 is not recorded. The app asks for a manual correction, reads the scale again on Next, or undoes. Negative (net) amounts are deferred.
  - A stable scale still flickers by a few tenths of a gram, so an amount slightly below 0 (by up to 0.3 g, configurable) counts as 0.
  - Only stable readings at Start and Next count, so lifting the bowl or a food item and putting it back before Next needs no handling.
  - MVP0 has no tare, lift or new-zero detection. A tare mid-meal produces a negative step, which goes through manual correction. Detection is deferred (see Deferred from MVP0).
  - Scale disconnect (e.g. auto-off after 1-3 min of stable weight): the app reconnects automatically to the same device and the flow continues. If reconnecting fails, the meal is finished with manual weights.
  - The scale must display grams. Otherwise Start and Next are disabled and the app asks to switch units.
  - A screen wake lock is held for the whole session, so the screen turning off doesn't suspend the page and drop the BLE stream.
  - Auto-zero drift: small amounts poured slowly (under ~3-5 g) may never show up. No software fix; the UI hints to add small calorie-dense items in one go or enter them manually.
- Future: add a custom ingredient that isn't in the recipe (MVP X, soon but not top priority). Reordering steps is not planned.

## Direct Entry (MVP0)

- Same step flow as Scale Mode, grams typed instead of read from the scale.
- The flow is shared with Scale Mode, so the extra cost is small, and it makes the whole flow usable without a scale.

## Vision Mode (future)

- Photo-based, AI-assisted. Identifies products from packaging and plate photos; can read weight from a scale display in the photo.
- Needs the backend to call the AI API (API key must not live in the client).

# Scale driver abstraction

```typescript
interface ScaleReading {
  grams?: number;       // absent while the scale shows another unit (M3-14)
  stable?: boolean;     // only when the scale reports it
  timestamp: number;    // ms, monotonic
  receivedAt: number;   // ms since the epoch, for the recording (M3-11)
  raw: Uint8Array;      // original payload, kept for recording/replay
}

interface ScaleCapabilities {
  hasStableFlag: boolean;
  canTare: boolean;
  resolutionGrams: number;
}

interface ScaleDriver {
  readonly id: string;
  readonly capabilities: ScaleCapabilities;
  connect(): Promise<void>;   // first call from a user gesture; after a drop, reconnects to the same device without the chooser
  disconnect(): Promise<void>;
  onReading(cb: (r: ScaleReading) => void): () => void;
  onConnectionChange(cb: (state: 'connected' | 'disconnected') => void): () => void;
  onRejectedFrame?(cb: (f: { raw: Uint8Array; timestamp: number; receivedAt: number }) => void): () => void;  // payloads the parser rejects, for the recording (M3-11)
  tare?(): Promise<void>;
}
```

- Drivers
  - `HuajunDriver` - adapter over `@mlewand/huajun-ble-scale` (`Scale` + `CapacitorTransport`). The library decodes bytes; the driver only maps its `Reading` to `ScaleReading`. A reading without `grams` (scale showing another unit) puts the driver in a "wrong unit" state. The library is read-only, so `canTare` is false.
    - Automatic reconnect needs a library change first: `CapacitorTransport.connect()` always opens the device chooser. The library must be able to connect to a known `deviceId` without it.
  - `MockScaleDriver` - plays readings described with a fluent test builder, e.g. `scaleScript().baseline(312).add(214, { overMs: 3000 }).stable()`. The builder compiles to plain data, so the same script works in unit tests and is passed into the page in e2e tests. Also used for development without the scale.
  - `ReplayScaleDriver` - replays a ScaleRecording with original timing (or accelerated). It re-parses the stored raw bytes with the library's current parser, so parser fixes can be checked against old recordings.
- Recording
  - Every capture session is recorded, also during normal use: raw payloads, parsed readings, user events.
  - Stored with the prepared meal on the backend; can be dumped/exported for investigation.
  - Raw payloads are kept so parser bugs can be reproduced, not only weight-tracking bugs. That includes the payloads the parser rejects, which a parser bug affects most.
  - A recording holds at most 20 000 frames (about 75 minutes at the Huajun scale's 225 ms) and counts the frames past that it leaves out.
  - Full rate: the whole stream of every capture session, up to the cap above. Sampling would drop the transients (tare, lift, auto-off) worth investigating, and the volume is small (roughly 100 KB per session).

# Macro tracking

- Daily targets (protein, fat, carbs, fibre, kcal) per user, defined in configuration/seed. No GUI for now. Any of them can be left unset.
- Today view: list of today's consumption entries, totals vs targets for protein, fat, carbs, fibre, kcal.
- Item macros = grams × per-100 g value / 100. Meal = sum of items. Day = sum of consumption entries.
- Future: GUI for targets, history view, adaptive targets.

# Usage data

- First-party usage events, to understand how the app is used. Stored in the app's Postgres behind the existing auth. No third-party analytics SDK: diet logs can count as health data under GDPR.
- The web app calls a typed `track(name, props)`; event names and props are defined in `packages/domain`. Events are batched to `POST /events`, and tracking never blocks or breaks the UI.
- No dashboards in MVP0; analysis with SQL.

# UI principles

- Clean and easy to understand.
- Wet-hands friendly: the phone is propped up while cooking. Huge Next button, current weight in large digits, undo for the last step.
- Future: nice animations so it's joyful to use (not a must on MVP0).

# Localization

- UI strings go through an i18n layer from day 0, English catalog only.
- Curated content (ingredient classes, recipe names) stored as LocalizedText (`{ en: "...", pl?: "..." }`). Only English authored now.
- User-entered content (product names) is plain text as printed on the package, not translated.
- Numbers: inputs accept both `3,2` and `3.2`; display via `Intl`. Metric only.

# Backend & sync

- Tiny API, multi-user from day 0. Users are provisioned from configuration/seed; no sign-up.
- Auth middleware resolves the session cookie to `userId` in the request context. Replacing it later with a real auth library (e.g. Better Auth) stays local to the middleware.
- Postgres: reuse the Postgres container already running on the host. The app gets its own database and its own role, which owns only that database. The API container reaches it over a shared external Docker network; connection via `DATABASE_URL`.
  - Migrations (Drizzle) run as an explicit step on deploy, never against other databases on that server.
  - Backups: include the app database in the existing Postgres backup routine (`pg_dump`).
  - Local development: web and api run on the host (`pnpm dev`); docker compose runs only a throwaway Postgres, pinned to the host's major version. It's the default in `.env.example`. Pointing `DATABASE_URL` at an existing Postgres server works the same way (own database, own role).
- Server is the source of truth. Client is online-first.
- The in-progress Direct Entry session is persisted locally (IndexedDB), so a reload doesn't lose it. Resuming a Scale Mode session after a reload is deferred.
- Saves go through an outbox in IndexedDB and are retried until the server accepts them. Client-generated IDs make retries idempotent.
- Seed data (recipes, classes, products) loaded from repo files. Seed products only go into an empty product store (see Cookbook database).
- Phase D: adding a product needs a connection; it doesn't go through the outbox. Picking a product already known works as before.
- Hosting: one Docker image (api + built web) on a separate LAN machine, behind the HTTPS reverse proxy.
- Future: offline-first sync, public sign-up, real auth library.

# Testing strategy

The app has to be well tested with automated tests at every step, both while building it and for later development.

- CI (GitHub Actions) runs everything on every push to `master` and on every pull request, except for documentation-only changes; red CI blocks merge.
- `packages/domain`: Vitest unit tests. Property-based tests (fast-check) for the weight tracker invariants, e.g. with no manual corrections and non-decreasing stable readings, the sum of step amounts equals the last Next reading minus the baseline.
- Replay regression tests: recorded sessions stored as fixtures with expected step amounts. Every bug investigated from a dump becomes a new fixture.
- Scale parsing is tested in `@mlewand/huajun-ble-scale`. The app tests only the mapping from the library's `Reading` to `ScaleReading`.
- `apps/api`: integration tests against PGlite, calling the app in-process (no network).
- Authorization tests: a user can never read or modify another user's data, for every endpoint.
- `apps/web`: component tests (Vitest + Testing Library); Playwright e2e on a phone viewport with `MockScaleDriver` injected into the production build by the test: the bundle honours a flag the test sets before the page loads, and loads the mock as a separate chunk, so e2e tests the artifact that ships. Scenarios: full meal (Scale Mode and Direct Entry), skip, manual correction, undo, scale disconnect with automatic reconnect, negative step leading to correction, wrong unit, Today totals.
- Real hardware (Web Bluetooth + my scale) can't run in CI: short manual smoke checklist per release.
- Line coverage thresholds: 90% for `domain`, 70% for `scale`, `api` and `web`.
- Acceptance criteria are written as testable statements; agents write the tests first. MVP0's are in this doc; from Phase D on, they're in GitHub issues (see Phases).

# Phases

Work proceeds in phases. MVP0 was Phases A to C. Each phase ends with the app deployed from the production image and used on the phone. The milestones in Acceptance criteria group criteria by area; the phases set the order of work. Criteria from a later phase are not implemented early.

## Phase A: Direct Entry end to end

- Goal: log a real meal with Direct Entry on the phone and see it in the Today view.
- Criteria: M1-1, M1-2, M1-4, M1-5, M1-7, M1-8; M2-1 to M2-6; M4-4, M4-5, M4-6, M4-8, M4-9; M5-1 to M5-7, M5-10; M7-1 to M7-7.
- Interim: no login. A stub auth middleware puts the seeded user's id into the request context. `ownerId` columns and owner-scoped repositories exist from the start, so Phase C only replaces the middleware. The app is reachable only on the LAN.
- Exit: a real meal logged with Direct Entry on the phone, visible on the tablet.

## Phase B: Rough Scale Mode

- Goal: log a real meal with the scale.
- Criteria: M3-1 to M3-6, M3-10, M3-12, M3-13, M3-14; M6-1 to M6-5, M6-9, M6-10; M6-8 without the reconnect scenario.
- Interim: no recording and no automatic reconnect. After a disconnect, the user finishes the meal with manual weights (M6-5).
- Exit: a real meal logged with the scale on the phone.

## Phase C: Hardening

- Goal: all MVP0 criteria pass.
- Criteria: M1-3, M1-6; M3-11; M4-1, M4-2, M4-3, M4-7, M4-10; M5-8, M5-9; M6-6, M6-7, the M6-8 reconnect scenario; M7-8.
- Exit: every MVP0 criterion passes, in CI or in the manual smoke checklist.

## Phase D: Product store

- Goal: no product is a dead end. A product the app doesn't know is added from the app, by barcode lookup or by typing its label, into one store shared by all users.
- Scope: the umbrella issue #70 and its sub-issues. More work may join this phase later; it's added here when it does.
- Criteria: in the GitHub issues, not in this doc. Each sub-issue lists its own, with IDs like `#123-3` (issue 123, criterion 3). The umbrella issue holds no criteria of its own; it closes when its sub-issues are closed. Issues labelled `on hold` belong to the phase's backlog, not its exit.
- Moved in from Deferred from MVP0: the kcal consistency check, as part of adding a product by its label.
- Moved in from Future stages: the products GUI; barcode scan with Open Food Facts lookup, plus a second provider to prove that providers chain.
- Exit: every criterion in the phase's issues passes, in CI or in a manual smoke run on the phone, and a product unknown to the app has been added by barcode and used in a meal on the phone.

# Acceptance criteria (MVP0)

No new criteria are added here: from Phase D on, criteria live in GitHub issues (see Phases). IDs are stable and never renumbered. Retired: M2-7, M3-7, M3-8, M3-9 (see Deferred from MVP0). See Phases for which phase each criterion belongs to.

## M1: Repository and CI skeleton

- **M1-1:** The pnpm monorepo contains `packages/domain`, `packages/scale`, `apps/web` and `apps/api`. `pnpm lint`, `pnpm typecheck` and `pnpm test` work from the repo root.
- **M1-2:** CI runs lint, typecheck, unit, API integration and e2e tests on every push to `master` and on every pull request. Changes to documentation only (`docs/` and Markdown files) skip it. Any failure fails the pipeline.
- **M1-3:** CI fails if line coverage drops below 90% in `domain`, or below 70% in `scale`, `api` or `web`. Entry points, config and generated files are excluded.
- **M1-4:** In development, web and api run on the host with `pnpm dev`; Docker Compose runs only Postgres, pinned to the host's major version.
  - The default is that local Postgres: `.env.example` points `DATABASE_URL` at it.
  - Using an existing Postgres server instead means changing only `DATABASE_URL`, with the production rules: own database, own role.
  - Vite proxies `/api` to the Hono dev server, so development uses one origin, like production.
  - The app loads on Android Chrome over HTTPS through the LAN reverse proxy, and HMR works through it.
- **M1-5:** Production builds one image.
  - Hono serves the `apps/web` build via `serveStatic`, falling back to `index.html` for non-API routes.
  - The service worker is served with `Cache-Control: no-cache`, so installed PWAs pick up new versions.
  - The container connects to the existing Postgres via `DATABASE_URL` on an external Docker network.
- **M1-6:** CI also runs the API tests against the host's exact Postgres version, as a service container.
- **M1-7:** CI enforces the package boundaries in `ARCHITECTURE.md`: `domain`'s tsconfig has no DOM or Node types, and ESLint `no-restricted-imports` rejects forbidden imports between packages.
- **M1-8:** `README.md` covers prerequisites (Node, pnpm, Docker), first-time setup (install, `.env`, database, migrations, seed), daily development including testing on the phone over HTTPS, test commands, and a short production deploy section. A fresh clone following only the README reaches a running dev app.

## M2: Domain, nutrition and macros

- **M2-1:** An item's nutrition equals grams × per-100 g value / 100, for every stored field.
- **M2-2:** A meal's total is the sum of its non-skipped items. Item grams must be ≥ 0; validation rejects negative values.
- **M2-3:** A nutrient's total is "unknown" if any contributing product has that value unknown (most often fibre). Otherwise it's numeric. An unknown value affects only its own nutrient's total.
- **M2-4:** Calculations use unrounded values. Only the display rounds: grams to 1 decimal, kcal to an integer.
- **M2-5:** A consumption entry counts toward the day in the user's timezone. Timestamps are stored in UTC, and the timezone is set per user in the seed. A meal at 23:30 Warsaw time counts toward that Warsaw day.
- **M2-6:** Product validation rejects negative values, and rejects per-100 g protein + fat + carbs + fibre + salt above 100 g. Unknown values count as 0 in that sum.

## M3: Scale layer and weight tracker

- **M3-1:** The weight tracker is a pure function of readings plus user events. It has no I/O and no timers of its own; time comes from reading timestamps.
- **M3-2:** Starting a session captures the baseline as the stable reading at "Start", so the bowl or plate is already on the scale. The container's weight is never counted as an ingredient.
- **M3-3:** A step's amount is the stable reading at this Next minus the stable reading at the previous Next (or the baseline, for the first step).
- **M3-4:** If the reading isn't stable when Next is tapped, the tracker waits up to 1.5 s. If it's still unstable after that, the last reading is proposed and the user must confirm it.
- **M3-5:** The tracker uses the driver's stable flag when there is one. Otherwise a reading counts as stable when readings stay within ±1 g for 1000 ms. Both values are configurable.
- **M3-6:** If a step amount would be below 0, the tracker doesn't record it. It emits a "needs correction" state, and the user enters the weight manually (M6-5), taps Next to read the scale again, or undoes. In MVP0 this is also what happens after a mid-meal tare. An amount below 0 by no more than a configurable tolerance (default 0.3 g, the scale's flicker while stable) counts as 0.
- **M3-10:** Property test: with no manual corrections and non-decreasing stable readings, the sum of step amounts equals the last Next reading minus the baseline.
- **M3-11:** Every raw frame (bytes and receive time) and every user event is recorded, up to 20 000 frames per session; frames past that are counted in the recording, so a replay of it is known to be incomplete. `ReplayScaleDriver` re-parses the stored bytes with the library's current parser, so replaying a complete recording (no frames counted as dropped) with unchanged parser and tracker behaviour gives the same step amounts. A parser or tracker fix can be checked against old recordings, and may change what they replay to. If the library doesn't expose the mapping from a parsed frame to a `Reading`, it gets added to the library rather than duplicated in the app.
- **M3-12:** Tests describe scale behavior with a fluent builder, e.g. `scaleScript().baseline(312).add(214, { overMs: 3000 }).stable().add(18)`. It compiles to plain data (timed readings), which unit tests feed to the tracker and e2e tests pass into the page for `MockScaleDriver`.
- **M3-13:** `packages/scale` uses `@mlewand/huajun-ble-scale` and never decodes bytes itself. Its tests cover only the mapping from the library's `Reading` to domain readings; parser tests live in the library.
- **M3-14:** A reading without `grams` (the scale shows another unit) puts the driver in a "wrong unit" state. The tracker ignores such readings.

## M4: API, authentication and ownership

- **M4-1:** Logging in with a seeded username and password sets an HttpOnly, Secure, SameSite=Lax session cookie.
  - A wrong username and a wrong password return the same 401, so logins can't reveal which usernames exist.
  - Passwords are hashed with argon2id.
  - The seed script reads initial passwords from environment variables and stores only hashes; the repo contains no passwords.
  - A CLI command resets a user's password.
- **M4-2:** Every endpoint except login and health returns 401 without a valid session.
- **M4-3:** An ownership test runs over the full route table: user B gets 404 for user A's resources, and list endpoints never include other users' rows. Each route registers a fixture that creates a resource owned by user A, or a stated exemption when it serves only global content, and the test fails for any route without either. From Phase D, products are global: a test checks that a product added by user A is visible to user B (#63).
- **M4-4:** Every request body is validated with the shared zod schemas. Invalid input returns 400 with field-level errors.
- **M4-5:** Running the seed script twice leaves the same state as running it once.
- **M4-6:** Saving a meal is idempotent through a client-generated ID. Posting the same meal twice creates exactly one meal and one consumption entry.
- **M4-7:** A meal's scale recording is stored with it and can be exported as JSON through an endpoint.
- **M4-8:** The health endpoint checks the database connection, and the Docker healthcheck uses it.
- **M4-9:** Migrations run only through an explicit command. The API refuses to start if the database schema is behind.
- **M4-10:** `POST /events` accepts batches of usage events, validates them against the event catalog in `domain`, and stores them with `ownerId`. M4-3 covers it.

## M5: Direct Entry flow

- **M5-1:** The user picks a recipe from the seeded list.
- **M5-2:** Each step shows its ingredient class and a product picker filtered to that class. The picker is sorted by the user's most recent use; with no history, the recipe's default product is preselected.
- **M5-3:** The grams input accepts both `3,2` and `3.2`, and rejects empty, non-numeric and negative values.
- **M5-4:** The user can skip a step.
- **M5-5:** Undo returns to the previous step with its product and grams restored.
- **M5-6:** The summary shows the items and the meal's macros. Any item's grams can be edited before Save.
- **M5-7:** Save creates the prepared meal and its consumption entry, and the meal appears in the Today view.
- **M5-8:** An in-progress Direct Entry session is kept in IndexedDB and survives a page reload, resuming at the same step.
- **M5-9:** A meal saved while offline goes into an outbox in IndexedDB, so it survives closing the app. The UI shows it as pending, and it's retried when the app starts or comes back online. Retries never produce a duplicate (M4-6).
- **M5-10:** A lint rule fails CI on hardcoded UI strings in JSX, since all UI text must come from the i18n catalog.

## M6: Scale Mode flow

- **M6-1:** The "Connect scale" button opens the device chooser. On the web it lists all nearby devices (`showAllDevices: true`), because Chrome's name filter doesn't match this scale; that's expected, not a bug to fix. The connection state is visible throughout the session.
- **M6-2:** "Start" is enabled only once the reading is stable, and it captures the baseline (M3-2).
- **M6-3:** The screen shows the amount added in the current step in large digits, and the scale's total reading smaller.
- **M6-4:** Next records the step amount per the M3 rules and shows the recorded value.
- **M6-5:** Any step's weight can be corrected manually, both during the flow and in the summary. A corrected item is saved with `weightSource: manual`.
- **M6-6:** If the scale disconnects mid-meal, the UI shows "Reconnecting" and keeps the session state. The app reconnects to the same device automatically, without the chooser, retrying with backoff and creating a new `Scale` instance per attempt. After reconnecting, the flow continues. If reconnecting fails, the user can finish the meal with manual weights (M6-5).
  - Prerequisite: `@mlewand/huajun-ble-scale` can connect to a known `deviceId` without the chooser, and exposes the `deviceId` picked on first connect.
- **M6-7:** The recording is uploaded together with the meal.
- **M6-8:** Playwright e2e tests with `MockScaleDriver` cover a full meal, skip, manual correction, undo, a disconnect with automatic reconnect, a negative step leading to correction (M3-6), and the wrong-unit state (M6-10).
- **M6-9:** A screen wake lock is held during a Scale Mode session. It's re-acquired when the page becomes visible again (the browser releases it when the page is hidden) and released when the session ends.
- **M6-10:** In the wrong-unit state (M3-14), Start and Next are disabled, and the screen asks the user to switch the scale to grams.

## M7: Today view and general requirements

- **M7-1:** The Today view lists the day's consumption entries in the user's timezone, newest first, each with the recipe name, time and macros.
- **M7-2:** For protein, fat, carbs, fibre and kcal it shows consumed, target and remaining. A nutrient without a target shows only consumed, with no target or remaining.
- **M7-3:** A nutrient total that is unknown per M2-3 (most often fibre) shows as "unknown".
- **M7-4:** The user can delete a consumption entry, after a confirmation step.
- **M7-5:** A meal saved on the phone appears on the tablet after a refresh.
- **M7-6:** Primary action buttons are full-width and at least 64 px tall. The live weight is at least 48 px. Everything works in portrait on both phone and tablet.
- **M7-7:** The PWA is installable: manifest and service worker pass Chrome's installability check.
- **M7-8:** The web app records usage events through a typed `track(name, props)`, with event names and props defined in `domain`. Events are batched to `POST /events`; tracking never blocks or breaks the UI. MVP0 events: flow started, finished and abandoned (with duration); step completed (with duration and weight source); skip; undo; manual correction; scale disconnect and reconnect.

# Deferred from MVP0

Mirrored in `TODO.md`. Each item states the behavior that applies until it's done.

- **Tare and bowl-lift detection mid-meal (unresolved):** cases are a tare between ingredients; the bowl lifted and put back; a small food item (e.g. a 15 g piece of apple) lifted and put back, which must still count as food; the scale re-zeroing after a power cycle during a disconnect. Until then: only stable readings at Start and Next count, and a negative step asks for manual correction (M3-6).
- **Manual scale reconnect:** a Reconnect button (user gesture, device chooser) for when automatic reconnect isn't possible, plus handling a possible new zero. Until then: automatic reconnect only (M6-6), with manual weights as the fallback.
- **Resume Scale Mode after page reload:** needs a reconnect and new-zero handling. Until then: only Direct Entry sessions resume (M5-8).
- **Negative item amounts** (net removal). Until then: item grams must be ≥ 0.
- **Usage data consent:** consent or opt-out, and inclusion in per-user export and deletion, before serving other users.

# Future stages (not MVP0)

- MVP X: add a custom ingredient during preparation.
- Partial consumption (sharing a meal) and cooked total weight for batch dishes.
- Vision Mode.
- GUIs: daily targets, recipes; user-defined recipes; vast recipe database.
- Product from nutrition label photo; barcode formats beyond EAN-13, EAN-8 and UPC-A; more lookup providers.
- Capacitor build for iOS.
- Offline-first sync.
- Public sign-up and a real auth library.
- GDPR before serving other users: diet logs can count as health data. Privacy policy, per-user data export and deletion, hosting location. `ownerId` on every user-owned row keeps export and deletion simple.
- Joyful animations.
- More scale drivers.
- More UI locales (Polish).

# Open questions

- None at the moment.
