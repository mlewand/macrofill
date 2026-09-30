#!/usr/bin/env bash
# Builds and (re)starts Macrofill in production: builds the image, applies migrations, loads the
# seed data, starts the container and waits until its health check passes. Run it for the first
# deploy and for every update:
#
#   git pull && ./deploy.sh
#
# Needs the .env described in README.md (DATABASE_URL, POSTGRES_NETWORK, APP_PORT) next to it.
set -euo pipefail
cd "$(dirname "$0")"

compose() { docker compose -f compose.prod.yml "$@"; }
step() { printf '\n==> %s\n' "$*"; }

if [ ! -f .env ]; then
  echo "Missing .env next to compose.prod.yml; see README.md, Production deploy." >&2
  exit 1
fi

step 'Building the image'
compose build

step 'Applying migrations'
compose run --rm app node migrate.mjs

step 'Loading seed data'
compose run --rm app node seed.mjs

step 'Starting'
compose up -d

step 'Waiting for the health check'
container=$(compose ps -q app)
status=unknown
for _ in $(seq 60); do
  status=$(docker inspect --format '{{.State.Health.Status}}' "$container")
  case $status in
    healthy)
      compose ps
      echo 'Macrofill is up and healthy.'
      exit 0
      ;;
    unhealthy) break ;;
  esac
  sleep 2
done
echo "Macrofill isn't healthy (last status: $status). Recent logs:" >&2
compose logs --tail 50 app >&2
exit 1
