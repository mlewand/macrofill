#!/usr/bin/env bash
# Smoke test of the production image against an empty Postgres (M4-8, M4-9):
# the app refuses to start before migrations, the image's migrate and seed work,
# and the Docker healthcheck turns healthy. Every step is time-bounded, so a
# regression fails the script instead of hanging CI.
#
# Usage: tooling/ci/image-smoke.sh <image> <database-url>
# The database must be empty and reachable from a container on the host network.
set -euo pipefail

image=$1
database_url=$2
refuse=macrofill-smoke-refuse-$$
app=macrofill-smoke-app-$$

trap 'docker rm -f "$refuse" "$app" >/dev/null 2>&1 || true' EXIT

container() {
  docker run --network host -e DATABASE_URL="$database_url" -e API_PORT=3999 "$@"
}

# Polls a container for up to $2 seconds until it has exited; returns 1 if it's still running.
wait_for_exit() {
  for _ in $(seq "$2"); do
    [ "$(docker inspect --format '{{.State.Running}}' "$1")" = true ] || return 0
    sleep 1
  done
  return 1
}

echo '--- M4-9: refuses to start while the schema is behind'
container -d --name "$refuse" "$image" >/dev/null
if ! wait_for_exit "$refuse" 30; then
  docker logs "$refuse" >&2
  echo "FAIL: the app started on an unmigrated database" >&2
  exit 1
fi
logs=$(docker logs "$refuse" 2>&1)
echo "$logs"
if [ "$(docker inspect --format '{{.State.ExitCode}}' "$refuse")" = 0 ] || ! grep -q 'schema is behind' <<<"$logs"; then
  echo "FAIL: expected a non-zero exit with 'schema is behind'" >&2
  exit 1
fi

echo '--- migrate and seed through the image'
timeout 120 docker run --rm --network host -e DATABASE_URL="$database_url" "$image" node migrate.mjs
timeout 120 docker run --rm --network host -e DATABASE_URL="$database_url" "$image" node seed.mjs
timeout 120 docker run --rm --network host -e DATABASE_URL="$database_url" "$image" node seed.mjs

echo '--- M4-8: the healthcheck turns healthy'
container -d --name "$app" "$image" >/dev/null
for _ in $(seq 60); do
  status=$(docker inspect --format '{{.State.Health.Status}}' "$app")
  if [ "$status" = healthy ]; then
    echo healthy
    exit 0
  fi
  if [ "$(docker inspect --format '{{.State.Running}}' "$app")" != true ]; then
    docker logs "$app" >&2
    echo "FAIL: the container exited" >&2
    exit 1
  fi
  sleep 1
done
docker logs "$app" >&2
echo "FAIL: not healthy after 60 s (last status: $status)" >&2
exit 1
