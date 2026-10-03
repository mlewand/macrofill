---
name: codebase-review
description: Bird's-eye review of the whole codebase for design, maintainability, modularity and dependency problems, with severity per finding. Manual only: run it solely when the maintainer types /codebase-review, never on your own initiative, at a phase exit or otherwise.
argument-hint: "[public | performance] [area...]"
disable-model-invocation: true
effort: xhigh
---

# Codebase review

A bird's-eye review of Macrofill, looking for problems that line-level PR review (Copilot, Codex) does not catch: the overall implementation design, maintainability, modularity, and dependency choices. Report only: change no code, open no PRs, create no issues.

**Manual trigger only.** This skill runs only when the maintainer invokes `/codebase-review` in a session. Do not start it, or suggest starting it, because a phase is ending, a phase-exit review PR is open, or any other workflow step in `AGENTS.md` comes up. It is not part of the phase-exit process; the maintainer decides when to run it.

Arguments: `$ARGUMENTS`

- No mode or `public` (default): the review below, published as a comment on issue #99.
- `performance`: the performance review (section "Performance mode"). Never published anywhere.
- Any further words are areas to limit the run to (`web`, `api`, `domain`, `scale`, `tooling`). With none, review everything.

## Working directory and resuming

All intermediate and final files go in the run directory `.review/<short-sha>/` at the repository root (`.review/<short-sha>-performance/` in performance mode), where `<short-sha>` is `git rev-parse --short HEAD`. `.review/` is gitignored. Never commit anything from it.

A run can be cut off at any point, for example when the usage limit is reached. The files in the run directory are the run's state, so a later `/codebase-review` with the same arguments picks up where the last one stopped. Before step 1, check the run directory and skip what is already done:

| Present in the run directory             | Resume at                                                    |
| ---------------------------------------- | ------------------------------------------------------------ |
| `published.md` listing every report part | Nothing to do. Tell the user the comment URLs.               |
| `report.md`                              | Step 5, posting only the parts not listed in `published.md`. |
| `verified.md`                            | Step 4.                                                      |
| `draft.md`                               | Step 3.                                                      |
| some `<slice>.md` files                  | Step 2, spawning only the slices without a file.             |
| `map.md`                                 | Step 2.                                                      |
| nothing                                  | Step 1.                                                      |

A file counts as present only under its final name. Every agent writes to `<name>.tmp` first and renames it when the file is complete, so a file cut off mid-write is never mistaken for a finished one. Delete leftover `*.tmp` files when resuming.

If HEAD has moved since an unfinished run, start a fresh run directory for the new commit, and tell the user the old one exists and is incomplete.

Tell the user at the start whether this is a fresh run or a resumed one, and from which step.

## Scope

In scope: all source under `apps/*/src`, `packages/*/src`, root and package configs (`package.json`, `tsconfig*`, `eslint.config.js`, `vite`/`vitest` configs), `Dockerfile`, compose files, `deploy.sh`, `.github/workflows`, `tooling/`.

Out of scope as review targets: test files (`*.test.*`, `test/`, `tests/`, `e2e/`), `test_data/`, generated migrations in `apps/api/drizzle/`. Reviewers may read them for context, for example to see how a module is meant to be used, but report no findings about them.

Not the focus of this review, so report only when it causes one of the in-scope problems: drift from `docs/requirements.md`, formatting, naming nits, single-line bugs.

## Review lenses

1. **Implementation design.** How the app is put together end to end: data flow from the scale and the UI through the outbox and the api to Postgres; where business logic lives (domain vs. web vs. api); state management in `apps/web`; the api's handler → service → repository layering; the zod contract in `domain` and how both sides use it; offline/outbox design; seed-as-source-of-truth for targets, recipes and classes. Ask: if the app doubled in features, where would this design break first?
2. **Maintainability.** Oversized modules and components (start from the largest files: `DirectEntry.tsx`, `ScaleMode.tsx`, `App.tsx`, `repositories/index.ts`, `TodayView.tsx`), mixed responsibilities, duplicated logic (Direct Entry and Scale Mode both build meals), divergent patterns for the same job (error handling, fetching, loading states, i18n use, date/time handling), hard-to-follow control flow, magic values, dead or near-dead code.
3. **Modularity.** Package boundaries and whether each package's contents belong there; cohesion inside packages; coupling across modules; leaky abstractions (`ScaleDriver`, the `hc` client, repositories); whether `docs/ARCHITECTURE.md`'s rules hold in spirit, not only where ESLint enforces them.
4. **Dependencies and tooling.** For every runtime and build dependency: is it needed, is it the right choice for this app, is it maintained, is there a lighter or better-fitting option, is the version policy sound. Also the build, CI, Docker image and deploy scripts as a whole: duplication, fragility, missing pieces.

## Severity

Every finding gets one severity and one effort. Severity answers one question: **what does it cost to leave this as it is while the app keeps growing?**

| Severity     | Meaning                                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Critical** | Already causes wrong behaviour or data loss, or blocks the next MVP phase. Fix before more feature work.                                                              |
| **High**     | Every new feature in this area pays for it: changes need edits in several places, or the design will not survive the next planned features. Fix in the current phase. |
| **Medium**   | Makes the code harder to understand or change, but contained to one area. Fix when that area is next touched.                                                         |
| **Low**      | Polish, small inconsistencies, nice-to-have improvements.                                                                                                             |

| Effort | Meaning                                                |
| ------ | ------------------------------------------------------ |
| **S**  | Under an hour, one or two files.                       |
| **M**  | A focused PR: several files, a few hours.              |
| **L**  | A refactor across modules or packages, or a migration. |

An improvement ("potential gain") with no current cost is at most **Low**, unless it removes a High problem as a side effect, in which case it belongs in that problem's finding.

## Process

### 1. Map (main agent, no subagents)

1. `git rev-parse HEAD` and `git log -1 --format=%cs`: record the commit and date. The report is about that commit.
2. Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/requirements.md` (skim for the MVP phase plan), `README.md`, every `package.json`, `eslint.config.js`, `.github/workflows/ci.yml`.
3. List the in-scope files with line counts. Write a short module map: each directory under `src`, what it does, its main exports, what it imports.
4. Save the map, with the commit and date at the top, to `map.md` in the run directory. Every reviewer gets it, so none of them re-derive the layout.

### 2. Review (parallel subagents)

Spawn one `general-purpose` subagent per slice that has no file yet, all in one message so they run in parallel:

| Slice           | Covers                                                                                       | Lenses  |
| --------------- | -------------------------------------------------------------------------------------------- | ------- |
| `web-ui`        | `apps/web/src` components: `App`, `directEntry`, `scaleMode`, `today`, `products`, `outbox`  | 1, 2, 3 |
| `web-infra`     | `apps/web/src` non-UI: `api`, `storage`, `session`, `events`, `i18n`, `scale.ts`, `scanner*` | 1, 2, 3 |
| `api`           | `apps/api/src` entire                                                                        | 1, 2, 3 |
| `packages`      | `packages/domain/src`, `packages/scale/src`                                                  | 1, 2, 3 |
| `deps-tooling`  | all `package.json`, configs, `Dockerfile`, compose, `deploy.sh`, CI, `tooling/`              | 4       |
| `cross-cutting` | the whole tree, reading for patterns rather than files                                       | 1, 2, 3 |

The `cross-cutting` slice looks only for problems that span slices: the same job done differently in different places, logic duplicated across packages, responsibilities in the wrong package, end-to-end data-flow problems. It does not repeat per-file findings.

If `$ARGUMENTS` names areas, spawn only the slices covering them, plus `cross-cutting` limited to those areas.

Each subagent's prompt contains: the path to `map.md`, its slice and lenses, the scope rules, the severity and effort tables above, and the finding format below. Tell each one:

- Read the code in full for its slice; do not sample.
- Report at most 15 findings, the most important first. Fewer, well-evidenced findings beat many weak ones.
- Every finding needs evidence a reader can check: `path:line` references and a short excerpt or a precise description of what is there. No evidence, no finding.
- Say what to do instead, concretely enough to start a PR from.
- Nothing about security vulnerabilities in the findings (see "Public repository" below): put those in a separate `## SECURITY` section at the end of the file.
- Write the findings to `<slice>.md.tmp` in the run directory, rename it to `<slice>.md` when complete, and reply with only the file path.

Finding format:

```markdown
### <short title naming the problem>

- **Severity:** High · **Effort:** M · **Lens:** Modularity
- **Where:** `apps/web/src/scaleMode/ScaleMode.tsx:120-310`, `apps/web/src/directEntry/DirectEntry.tsx:88-240`
- **Problem:** what is wrong, with the evidence.
- **Cost of leaving it:** what it makes harder, concretely.
- **Recommendation:** what to change it to.
```

### 3. Verify (one fresh subagent)

Merge the slice files into `draft.md`, removing duplicates (keep the better-evidenced one, merge `Where` lists), and move every `## SECURITY` section into `security-private.md`. Then spawn one new `general-purpose` subagent that has not seen the reviews being written. Its job is to check each finding in `draft.md` against the code:

- **Confirmed**: the evidence holds and the severity fits the rubric. Keep.
- **Adjusted**: real, but the severity or effort is wrong, or the recommendation would not work. Fix it and say why in one line.
- **Rejected**: the evidence is wrong, the code already handles it, or it is a matter of taste with no real cost. Drop it.

It writes the result to `verified.md` (through `.tmp`), with a count of confirmed, adjusted and rejected findings.

### 4. Report

Write `report.md` (through `.tmp`):

```markdown
# Codebase review — <date> @ <short sha>

<3–5 sentences: the overall state of the design, the one or two things that matter most, and whether anything should stop feature work.>

## Summary

| # | Severity | Effort | Lens | Finding |
| - | -------- | ------ | ---- | ------- |
<one row per finding, sorted by severity then effort (S first)>

## Findings

<findings grouped by severity, Critical first, numbered to match the table>

## Dependencies

<a table of every runtime dependency: package, used for, verdict (keep / replace with X / remove), one-line reason>

## Method

Commit <sha>. Slices reviewed: <list>. <n> findings drafted, <n> confirmed, <n> adjusted, <n> rejected in verification. Test files were out of scope.
```

A GitHub comment holds at most 65,536 characters. If `report.md` is longer, split it at finding boundaries into `report-1.md`, `report-2.md` and so on, each headed `Codebase review — <date> @ <short sha> (part n/m)`, with the Summary table in part 1.

### 5. Publish (public mode only)

1. Show the user the Summary table and the overall paragraph, and ask before posting. Posting is a public comment on a public repository.
2. On a yes, post each part not yet listed in `published.md`, in order, with the default `gh` account (never the maintainer's review token):
   `gh issue comment 99 --repo mlewand/macrofill --body-file <run directory>/report.md` (or `report-<n>.md`)
3. Right after each successful post, append the part's file name and comment URL to `published.md`, so a resumed run never posts a part twice. Before posting on a resumed run, also check #99's latest comments for one already headed with this run's date and sha, and record it instead of posting again.
4. Reply with the comment URL(s). If `security-private.md` has content, tell the user it exists and its path.

## Public repository

The repository and issue #99 are public. The published report must not contain:

- exploitable security weaknesses (auth, session handling, injection, secrets, exposed endpoints, known-vulnerable dependency versions),
- performance findings,
- hostnames, IPs, tokens or any value from `.env`.

Security findings stay in `security-private.md` in the run directory. Do not publish it anywhere.

## Performance mode

When `$ARGUMENTS` starts with `performance`: run steps 1–4 in `.review/<short-sha>-performance/` with these slices instead of the ones in step 2, and **skip step 5**.

| Slice         | Covers                                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web-runtime` | React render cost (re-renders, missing memoisation where it matters, large component trees), IndexedDB access, scale data handling, timers         |
| `web-bundle`  | Bundle size and composition, code splitting, PWA precache and service worker strategy, fonts and assets, startup path on a mid-range Android phone |
| `api-db`      | Query shapes, N+1 patterns, missing indexes against `schema.ts`, payload sizes, per-request work, lookup timeouts and concurrency                  |

If `pnpm build` works in this environment, run it and use the real chunk sizes from its output in `web-bundle`.

Severity uses the same table, read as the cost to the user on the phone (Critical: a visible freeze or failure in normal use; High: noticeable lag in a common flow; Medium: measurable but rarely felt; Low: theoretical).

The report stays in the run directory; give the user the path to `report.md`. Never post it, commit it, or put it in a PR.
