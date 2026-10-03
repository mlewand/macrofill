# AGENTS.md

Diet tracking app (working name Macrofill). It logs a multi-ingredient meal while you make it, using a Bluetooth kitchen scale, and tracks daily macros against targets. PWA for Android Chrome, pnpm monorepo, TypeScript.

Read before any work:

- `docs/requirements.md`: requirements, MVP0's acceptance criteria (IDs like `M3-6`) and phases. The source of truth.
- The current phase's GitHub issues: from Phase D on, acceptance criteria live there (IDs like `#123-3`), not in `docs/requirements.md`.
- `docs/ARCHITECTURE.md`: package roles and import rules.
- `docs/TODO.md`: deferred items. Don't implement them.

Current phase: **D, Product store** (started 2026-10-03). Its scope is the umbrella issue #70 and its sub-issues, plus three independent issues added on 2026-10-03: #88 (the saved-meal screen), #89 (the scale stays connected between meals) and #95 (sign out). Sub-issues labelled `on hold` wait for the maintainer. MVP0 (Phases A to C) is done: its exit was confirmed on 2026-10-02, when the cumulative review (#57) merged. The product store's own work (#63 to #67) is done, and the maintainer's smoke run on the phone passed on 2026-10-03 (barcode scan, the fallbacks when the code is invalid or there is no camera, products added by barcode lookup and found again without a form, and the scale's Bluetooth connection untouched); the phase exits when the added issues are done too. Update this line when a phase starts or its exit criteria are met.

## How to work

- Work in the current phase only (see Phases in the requirements). Don't implement criteria from a later phase, `TODO.md`, Future stages, or issues labelled `on hold`.
- One milestone, or one coherent group of criteria, per pull request (see Git workflow).
- Tests first: write failing tests for the criteria you're implementing, then the code. Put the criterion ID in the test name, e.g. `it('M3-6: negative step asks for correction', ...)`, or for a criterion from an issue `it('#123-3: an unknown barcode opens the product form', ...)`.
- Never change requirements, criteria (in `docs/requirements.md` or in issues), `docs/ARCHITECTURE.md` or `docs/TODO.md` silently. If a criterion is ambiguous, contradicts another, or looks wrong, stop and ask. If it has to change, propose the edit and say why.
- Never weaken tests, coverage thresholds or lint rules to get a green build.
- **Every business logic bug that's discovered gets a regression test**, whether it was found in review, testing or use. The test references the pull request or GitHub issue where the bug was found: add `(regression: #<number>)` at the end of the test name, after the criterion ID, e.g. `it('M4-6: a retry naming a different entry is a conflict (regression: #11)', ...)`. Check that the test fails without the fix and passes with it. A test that passes either way doesn't guard anything. `pnpm test -t 'regression: #'` runs them all.
- Before finishing: `pnpm lint`, `pnpm typecheck` and `pnpm test` pass from the repo root.
- Keep `README.md` current when setup, commands or deployment change.
- Commit messages name the criterion IDs they cover.

## Git workflow

- Never commit to `master` directly. Work on a dedicated branch and merge through a pull request.
- Commit as you go: one commit per small, self-contained change, where possible.
- Open a PR once the branch holds a deliverable. Keep PRs reasonably sized. If the work is bigger, split it into stacked PRs (each branch based on the previous one) and name the base PR in the description. Before stacking on a PR that hasn't been reviewed yet, start an independent PR for another task on the list, if there is one: the base PR then has time to get its review before more work builds on it. Stack on an unreviewed PR only when no independent work is left.
- Keep at most 4 of your PRs open at a time, stacked ones included. At the cap, work on the open ones instead of starting another.
- A PR description opens with a short overview that someone who barely knows the product, such as an end user, would understand: what changes for them, and why, in a few sentences. The details follow: the criterion IDs it covers, the assumptions it makes, what it doesn't handle (including the issues extracted in review, see Handling reviews), then implementation notes. `.github/pull_request_template.md` has the layout.
- Do branch work in a `git worktree`, and keep the main checkout on `master`: it may be serving the dev server, and switching branches under a running Vite can break its config reload. Pull `master` there after merges.
- A PR is ready for review when CI is green. Reviews come from Codex by default. GitHub Copilot reviews are for bigger or riskier PRs, and are requested less often. CodeRabbit may review too; it's welcome but not required. Handle the findings as Handling reviews says.
- At the end of a phase, before its exit, a cumulative review covers everything the phase changed. A base branch at master's commit from the phase's start, and a head branch starting as current master, in a PR marked as not to be merged into that base. Fixes go on the head branch, so they're reviewed in context. When it's approved, retarget the PR to `master` (its diff shrinks to the fixes), merge it, and delete both branches. Phase B's was #29, covering #22 to #28. #30, a small UI change merged after it, was reviewed on its own. Phase C's was #57, covering #33 to #52; findings the maintainer deferred are issues that link the review threads they came from. Phase D's was #85, covering #71 to #76: it had no fixes, so it was closed instead of merged, and its one finding is issue #90.
- Request the first review, and a re-review after each round of fixes (every thread answered and resolved, CI green on the new head), once per round. Codex answers only to the maintainer's account, so the request is a PR comment posted as the maintainer, with exactly this text: `Asking for @codex review on @mlewand behalf.` Copilot is requested as a reviewer, also as the maintainer. How an agent gets that access is harness-specific (Claude Code: see `CLAUDE.md`). Without it, tell the maintainer the PR is ready instead.

## Handling reviews

Not every finding has to be fixed in the PR that drew it. #37 and #41 went through more than 30 review threads each, mostly over scenarios the product doesn't support, and each fix drew new findings; that must not happen again.

Judge each finding by how it affects the user in realistic use: the product as `docs/requirements.md` scopes it, including the accepted shortcuts in MVP0 scope (e.g. one user per device). A problem that needs an unsupported setup or an unlikely chain of failures is theoretical.

Every finding, including points that appear only in a review summary, gets one of these outcomes, and a reply that says which. Reply on inline threads and resolve them; answer summary points with a PR comment. Check a finding before acting on it.

- **Fix** it in the PR when it would open a security hole, however unlikely, or when, in realistic use, the PR would cause a regression in something that worked or data loss or corruption, or would leave a criterion it covers unmet. Any other high or critical finding the PR causes is fixed too; leaving one to an issue needs the maintainer's OK, noted with it under "Not handled". Reply with the fixing commit.
- **Extract** it to an issue when it's low or medium priority, theoretical problems included. The issue links where it came from (a permalink to the review thread or the code), says what goes wrong for the user, and gets a priority label, plus `data loss` when user data could be lost or corrupted. Reply with the issue link and its priority, list it under "Not handled" in the PR description, so re-reviews don't raise it again, and resolve the thread.
- **Reject** it when it doesn't hold: say why, with evidence.
- **Skip** it when it's unrelated to the PR's purpose, e.g. about code the PR doesn't change: say so in one line. Open an issue for it only when it's high or critical.

Priority is judged from the product side: how much it affects the user, counting how likely it is. A security hole is the exception: it's critical whatever its likelihood. A scenario that the accepted shortcuts rule out (e.g. two users on one device) isn't realistic use, though, so it isn't a security hole either. The labels (create a missing one with `gh label create`):

- `priority: critical`: a security hole, however unlikely; or, in realistic use, data loss or corruption, or the app unusable.
- `priority: high`: a core flow (logging a meal, Today) broken or wrong in normal use.
- `priority: medium`: a noticeable annoyance, or a wrong result in an uncommon but realistic case, with a workaround.
- `priority: low`: a rare edge case, a theoretical problem, or something cosmetic.

**Escalation after 20 reviews.** Count the reviews submitted on the PR (by Codex, Copilot, CodeRabbit or people), as GitHub lists them. GitHub also lists each reply on a review thread as a comment-only review with an empty body; those don't count. An approval or a change request counts even without a body. Once the PR has 20 and the latest review still has findings to fix, stop working on it:

- Post a PR comment for the maintainer: why the reviews keep finding things (the themes they come back to, and which findings came from earlier fixes), what has been fixed and extracted so far, and how you suggest proceeding (an accepted shortcut to propose, a narrower scope, a split or a different design).
- Add the `needs-maintainer` label, and tell the maintainer.
- Leave the PR alone until the maintainer answers. Other work goes on, within the cap.

When the maintainer gives the go-ahead, remove the label. The count starts again from then: after 20 more reviews, the same applies. To count (after a go-ahead, add `| select(.submitted_at > "<go-ahead time>")` before `| .id`):

```sh
gh api 'repos/{owner}/{repo}/pulls/<number>/reviews' --paginate \
  --jq '.[] | select(.body != "" or .state != "COMMENTED") | .id' | wc -l
```

## Review guidelines

For code reviewers (Codex, Copilot, CodeRabbit), and agents reviewing a PR:

- Review for realistic use of the product as `docs/requirements.md` scopes it, accepted shortcuts included. In MVP0 each phone or tablet is used by one person, so switching users on one device, across tabs or with browser storage blocked isn't a scenario to review for. The server keeping users apart (M4-1 to M4-3) is.
- What matters most: regressions in what worked, data loss or corruption, security, and the acceptance criteria the PR names.
- Rate each finding by its impact on the user in realistic use, likelihood included, not by its worst case, and say what the user would see. A security hole is the exception: always the highest priority.
- Don't raise again what the PR description lists under "Not handled", or what an open issue already tracks, unless Handling reviews says to fix it in the PR (Fix). An item the PR description notes the maintainer agreed to defer isn't raised again either; a security hole always is. Leave problems in code the PR doesn't change alone, unless they're severe.
- When a finding follows from the fix of an earlier one, say so.

## Conventions

- TypeScript `strict` everywhere.
- Dependencies respect pnpm's `minimumReleaseAge` (brand-new releases are held back). Don't add `minimumReleaseAgeExclude` entries; use a version range that allows an older release. pnpm adds such entries on its own when you ask for a version that's too new, so check `pnpm-workspace.yaml` after adding dependencies.
- The zod schemas in `packages/domain` are the API contract. Web and api import them and never redefine the same shapes.
- `packages/domain` has no I/O, no clock and no randomness. Pass time and IDs in.
- Scale byte decoding lives in `@mlewand/huajun-ble-scale`. If the library lacks something, report it instead of reimplementing it; the change belongs in the library.
- Every user-owned table has `ownerId`, and all queries go through the repositories, scoped by the owner for user-owned data. Global content (ingredient classes, recipes and products) has no owner: products are one store shared by all users, and `products.createdBy` is no ownership scope and never leaves the server. The one exception to user scoping is the auth repository, which finds the user by username or session before there is one (`docs/ARCHITECTURE.md`).
- Entity IDs are UUIDs generated by the client, so saves can be retried safely.
- Schema changes are Drizzle migration files, generated from `apps/api/src/db/schema.ts` with `pnpm -F @macrofill/api db:generate`. Never edit a migration that has been merged. Migrations run only through the explicit migrate command.
- All UI text goes through the i18n catalog (English only for now). Number inputs accept both `3,2` and `3.2`.
- `test_data/nutritional_example.json` holds real per-100 g label values for candidate seed products (sandwich and curd recipes). Its field names differ from the domain `NutritionValues` (`kcals`, `carbohydrates`, `sugar`, `saturatedFat`), so map them. It has no fibre, and some products also lack other values (`null`). Missing values must load as unknown, never 0 (M2-3).

## Scale and hardware

- The real scale isn't available in CI or to you. Use `MockScaleDriver` with the `scaleScript()` builder.
- Web Bluetooth needs HTTPS and a user gesture for the first connect. On the web the device chooser lists all devices (`showAllDevices: true`) because Chrome's name filter doesn't match this scale. That is expected.
- The weight tracker's decisions beyond the criteria text are in the descriptions of #22, #27 and #29: correction references, undo back to before Start, and M3-1 kept literal for a stalled stream. Its settings, for tuning on the real scale, are in `apps/web/src/scaleMode/settings.ts`.

## Commands

Root scripts; keep this list in sync with `package.json`. Rows marked *(pending)* don't exist yet.

| Command | Purpose |
|---|---|
| `pnpm dev` | Run web (Vite, proxies `/api`) and api on the host; settings in `.env` (copy `.env.example`) |
| `pnpm db:up` | Start the local Postgres 17 in Docker Compose |
| `pnpm build` | Build web and api (`apps/*/dist`); the `Dockerfile` runs it |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL`; the api refuses to start while any are pending |
| `pnpm db:seed` | Load seed data from `apps/api/src/seed/data.ts` (idempotent). Initial passwords come from `SEED_PASSWORD_<USERNAME>`, set only for users without one |
| `pnpm db:password <username>` | Set a user's password, read from stdin (M4-1) |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Checks that must pass before finishing. `lint` runs ESLint and `prettier --check` |
| `pnpm test:coverage` | `pnpm test` with the per-package line coverage thresholds (M1-3), as CI runs it. Only a full run checks them: with `--project` or a file filter, the thresholds see no files and pass |
| `pnpm format` | Format with Prettier |
| `pnpm test:e2e` | Playwright tests on phone and tablet viewports (portrait), against the production build served by the api. Uses its own database (`DATABASE_URL` + `_e2e`, or `E2E_DATABASE_URL`), wiped and reseeded each run |

Running a subset of tests (Vitest projects are named `domain`, `scale`, `web`, `api` and `repo` for the root `tests/`):

- by criterion ID: `pnpm test -t 'M3-6'`, or `pnpm test:e2e -g 'M6-8'`
- one project: `pnpm test --project domain`, or `pnpm -F @macrofill/domain test`
- one file: `pnpm test packages/domain/test/tsconfig.test.ts`
- api tests on a real Postgres, as CI's M1-6 job: `API_TEST_DATABASE_URL=<server url> pnpm test --project api` (the role needs CREATEDB)

## Saving coding agent information

When feasible `AGENTS.md` should be preferred for storing information over `CLAUDE.md`.

`Claude.md` should be used only for truly claude specific instructions that are not useful for other LLM harness.
