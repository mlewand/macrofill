# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

All project instructions live in `AGENTS.md` (shared with other agent harnesses). Add only Claude-specific instructions here.

@AGENTS.md

## Watching PR reviews

With open PRs, run `.claude/scripts/pr-watch.sh` as a `Monitor` source, so reviews, comments, reactions and merges on them arrive as notifications within about 2 minutes:

- command: `.claude/scripts/pr-watch.sh <scratchpad>/pr-watch.state`. Keep the state file out of the repo.
- `timeout_ms: 1800000`, the maximum, and re-arm it whenever it expires.

Handle each event with the review workflow in `AGENTS.md`. Monitor only runs while this session does.

## Requesting reviews

The maintainer's fine-grained token (their account, this repo only, Pull requests read and write) is in `~/.config/macrofill/review-token`, outside the repo. Use it per command only, never as the default `gh` identity, and only for these two actions:

```sh
# Codex: the first review, or a re-review after a round of fixes
GH_TOKEN=$(tr -d '[:space:]' < ~/.config/macrofill/review-token) \
  gh pr comment <number> --body 'Asking for @codex review on @mlewand behalf.'

# Copilot, for bigger or riskier PRs only
GH_TOKEN=$(tr -d '[:space:]' < ~/.config/macrofill/review-token) \
  gh pr edit <number> --add-reviewer @copilot
```

Never approve, review, comment otherwise or change anything else as the maintainer. Everything else stays on the default `gh` account.
