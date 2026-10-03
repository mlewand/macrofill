# Code review instructions

Prioritize finding defects and maintainability problems over stylistic comments.

Follow the Review guidelines in `AGENTS.md`: they set which scenarios count and how to rate a finding.

When reviewing changes:

- Look for incorrect behavior, regressions, and edge cases left unhandled that can happen in realistic use.
- Look for incorrect assumptions about null/undefined values and empty collections.
- Check asynchronous code for missing awaits, races, stale state, and incorrect error propagation.
- Check resource lifecycle and cleanup.
- Look for incorrect error handling and errors that are silently swallowed.
- Identify logic that works for the happy path but fails for plausible boundary conditions.
- Check whether changes violate existing invariants or assumptions elsewhere in the codebase.
- Identify unnecessarily complicated implementations when a substantially simpler implementation exists.
- Look for duplication or new abstractions that don't justify their complexity.
- Check public API changes for backwards compatibility.
- Identify missing tests for important behavior introduced or changed by the PR.
- A fix for a business logic bug must come with a regression test that references the PR or GitHub issue where the bug was found, as `(regression: #<number>)` in the test name (see `AGENTS.md`). Flag a fix without one, and a regression test that would pass even without the fix.
- Pay particular attention to interactions between changed files rather than reviewing files independently.

Do not comment on formatting or stylistic issues that can be handled by automated linters.

Do not suggest refactoring merely because an alternative implementation is possible.
Only suggest a refactor when there is a concrete readability, correctness,
maintainability, or performance benefit.

For every issue, explain the concrete failure mode or maintenance problem.
Avoid speculative comments without a plausible scenario.
