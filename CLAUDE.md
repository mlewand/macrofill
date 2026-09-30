# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

All project instructions live in `AGENTS.md` (shared with other agent harnesses). Add only Claude-specific instructions here.

@AGENTS.md

## Watching PR reviews

With open PRs, run `.claude/scripts/pr-watch.sh` as a `Monitor` source, so reviews, comments, reactions and merges on them arrive as notifications within about 2 minutes:

- command: `.claude/scripts/pr-watch.sh <scratchpad>/pr-watch.state`. Keep the state file out of the repo.
- `timeout_ms: 1800000`, the maximum, and re-arm it whenever it expires.

Handle each event with the review workflow in `AGENTS.md`. Monitor only runs while this session does.
