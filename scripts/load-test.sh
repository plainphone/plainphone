#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Sync load test against a local copy of the hosted setup (docs/operations.md#capacity).
# Builds the production image, starts it with deploy/dokploy-compose.yaml's limits (768 MB app,
# Postgres 18, pool of 10), seeds synthetic households, then runs server/test/load-sync.ts:
# a steady phase with every phone syncing once a minute, an app restart, and a burst with
# every phone at once. Never point this at a real server: it only talks to the local copy.
#
#   scripts/load-test.sh [phones=500] [steady-minutes=10] [burst-minutes=3]
# Results: JSON per phase in $LOAD_OUT (default load-results/<timestamp>/). Needs Docker and pnpm.
set -euo pipefail
cd "$(dirname "$0")/.."

phones=${1:-500}
steady=${2:-10}
burst=${3:-3}
wakes=${LOAD_WAKES_PER_HOUR:-4}
out=${LOAD_OUT:-load-results/$(date -u +%Y%m%dT%H%M%SZ)}
mkdir -p "$out"
out=$(cd "$out" && pwd)

export COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-pp-load-$$}
export POSTGRES_PASSWORD=load-test-only PUBLIC_URL=http://localhost DNS_PROVIDER=mock
compose=(docker compose -f deploy/dokploy-compose.yaml -f scripts/load/compose.override.yaml)

cleanup() { "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

"${compose[@]}" build -q app
"${compose[@]}" up -d --wait --quiet-pull
app=$("${compose[@]}" ps -q app)
db=$("${compose[@]}" ps -q db)
port=$("${compose[@]}" port app 8080 | sed 's/.*://')
base="http://127.0.0.1:$port"

wait_healthy() {
  for _ in $(seq 1 120); do
    if curl -fsS "$base/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "app did not become healthy" >&2
  return 1
}
wait_healthy

"${compose[@]}" exec -T db psql -q -U plainphone -d plainphone -v phones="$phones" < scripts/load/seed.sql
echo "seeded $phones households and phones"

loadgen() {
  (cd server && pnpm exec tsx test/load-sync.ts --base "$base" --phones "$phones" \
    --wakes-per-hour "$wakes" --app-container "$app" --db-container "$db" "$@")
}

echo "== steady: $phones phones, $steady minutes"
loadgen --minutes "$steady" --out "$out/steady.json"

echo "== restart the app, then burst: every phone at once"
"${compose[@]}" restart app >/dev/null
# The random host port changes with the restart.
port=$("${compose[@]}" port app 8080 | sed 's/.*://')
base="http://127.0.0.1:$port"
wait_healthy
loadgen --minutes "$burst" --burst --out "$out/burst.json"

if [ "$(docker inspect -f '{{.State.OOMKilled}}' "$app")" = true ]; then echo "the app was OOM-killed" >&2; exit 1; fi
echo "results in $out"
