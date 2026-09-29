#!/usr/bin/env bash
# Smoke test of the production image against an empty Postgres (M4-8, M4-9):
# the app refuses to start before migrations, the image's migrate and seed work,
# and the Docker healthcheck turns healthy.
#
# Usage: tooling/ci/image-smoke.sh <image> <database-url>
# The database must be empty and reachable from a container on the host network.
set -euo pipefail

image=$1
database_url=$2
name=macrofill-smoke-$$

run() { docker run --rm --network host -e DATABASE_URL="$database_url" -e API_PORT=3999 "$image" "$@"; }

echo '--- M4-9: refuses to start while the schema is behind'
if output=$(run 2>&1); then
  echo "FAIL: the app started on an unmigrated database" >&2
  exit 1
fi
echo "$output"
grep -q 'schema is behind' <<<"$output"

echo '--- migrate and seed through the image'
run node migrate.mjs
run node seed.mjs
run node seed.mjs

echo '--- M4-8: the healthcheck turns healthy'
docker run -d --name "$name" --network host -e DATABASE_URL="$database_url" -e API_PORT=3999 "$image" >/dev/null
trap 'docker rm -f "$name" >/dev/null' EXIT
for _ in $(seq 60); do
  status=$(docker inspect --format '{{.State.Health.Status}}' "$name")
  if [ "$status" = healthy ]; then
    echo healthy
    exit 0
  fi
  if [ "$(docker inspect --format '{{.State.Running}}' "$name")" != true ]; then
    docker logs "$name" >&2
    echo "FAIL: the container exited" >&2
    exit 1
  fi
  sleep 1
done
docker logs "$name" >&2
echo "FAIL: not healthy after 60 s (last status: $status)" >&2
exit 1
