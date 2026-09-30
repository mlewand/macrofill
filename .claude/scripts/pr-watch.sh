#!/usr/bin/env bash
# Watches the current user's open pull requests in this repo and prints one line per new event:
# a review, an inline or conversation comment, a reaction to one of the user's own comments (Codex
# answers "no issues" with only a 👍), and a PR getting merged or closed. The user's own activity
# is skipped. Meant as a Claude Code Monitor source; see CLAUDE.md.
#
# Usage: pr-watch.sh STATE_FILE [INTERVAL_SECONDS]
#   STATE_FILE holds the IDs already seen, so a restarted watch doesn't repeat events. Keep it
#   outside the repo. If it doesn't exist, the first pass only records what's there already.
#   INTERVAL_SECONDS defaults to 120.

set -uo pipefail

state=${1:?usage: pr-watch.sh STATE_FILE [INTERVAL_SECONDS]}
interval=${2:-120}
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner) || exit 1
me=$(gh api user --jq .login) || exit 1

seed=false
[[ -f $state ]] || { seed=true; : >"$state"; }

# Prints "KEY<TAB>MESSAGE" lines for everything that has happened on PR $1. Fails if any request
# fails, so a caller can tell a complete list from a partial one.
events() {
  local n=$1 skip_me="select(.user.login != \"$me\")" failed=0 comments key message
  gh api "repos/$repo/pulls/$n/reviews" --paginate --jq ".[] | $skip_me |
    \"review:\(.id)\tPR #$n: review by \(.user.login), \(.state)\"" || failed=1
  gh api "repos/$repo/pulls/$n/comments" --paginate --jq ".[] | $skip_me |
    \"inline:\(.id)\tPR #$n: inline comment by \(.user.login) on \(.path):\(.line // .original_line) (id \(.id))\"" || failed=1
  comments=$(gh api "repos/$repo/issues/$n/comments" --paginate --jq ".[] |
    if .user.login == \"$me\" then \"mine:\(.id)\" else
    \"comment:\(.id)\tPR #$n: comment by \(.user.login): \(.body | gsub(\"\\\\s+\"; \" \") | .[0:120])\" end") || failed=1
  while IFS=$'\t' read -r key message; do
    [[ -z $key ]] && continue
    if [[ $key == mine:* ]]; then
      # Reactions from others on the user's own comments, e.g. Codex's 👍 on "@codex review".
      gh api "repos/$repo/issues/comments/${key#mine:}/reactions" --paginate --jq ".[] | $skip_me |
        \"reaction:\(.id)\tPR #$n: \(.user.login) reacted \(.content) to comment ${key#mine:}\"" || failed=1
    else
      printf '%s\t%s\n' "$key" "$message"
    fi
  done <<<"$comments"
  return "$failed"
}

# Prints the events on PR $1 not seen before, and records them as seen. Fails, recording nothing,
# if the events couldn't all be fetched.
report() {
  local all key message
  all=$(events "$1") || return 1
  while IFS=$'\t' read -r key message; do
    [[ -z $key ]] && continue
    grep -qxF "$key" "$state" && continue
    echo "$key" >>"$state"
    $seed || echo "$message"
  done <<<"$all"
}

while true; do
  # If listing fails, skip the pass: an empty list would look like every PR had closed.
  if ! open=$(gh pr list --repo "$repo" --author "$me" --state open --limit 1000 \
    --json number --jq '.[].number'); then
    sleep "$interval"
    continue
  fi

  # PRs that were open on an earlier pass and aren't now: merged or closed.
  while read -r key; do
    n=${key#open:}
    if ! grep -qx "$n" <<<"$open"; then
      status=$(gh pr view "$n" --repo "$repo" --json state --jq .state) || continue
      [[ $status == OPEN ]] && continue
      # Activity since the last pass comes before the merge or close. If it can't all be fetched,
      # keep the PR tracked and try again on the next pass.
      report "$n" || continue
      $seed || echo "PR #$n: $status"
      { grep -vx "$key" "$state" || true; } >"$state.tmp" && mv "$state.tmp" "$state"
    fi
  done < <(grep '^open:' "$state")

  complete=true
  for n in $open; do
    grep -qx "open:$n" "$state" || echo "open:$n" >>"$state"
    report "$n" || complete=false
  done

  # The first pass only records what's there. It ends once every PR's events were fetched, or
  # a PR's history would come out as new on the next pass.
  $complete && seed=false
  sleep "$interval"
done
