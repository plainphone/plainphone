#!/bin/bash
# The new-parent onboarding walk (docs/testing.md#onboarding-walk): plainphone.org → "Get started" →
# sign-in link → household → child → setup QR → a simulated phone enrolls over the device API →
# dashboard health → one rule change → the phone's /device/rules. English and Danish, 390 and
# 1280 px. Everything runs on loopback: a throwaway PostgreSQL 18 in Docker (or DATABASE_URL), the
# server with MAIL_PROVIDER=log and BOT_CHALLENGE=altcha, the Vite dev server and the built site.
# Links to app.plainphone.org are answered locally by the browser and never leave the machine.
#   web/scripts/onboarding-walk.sh <output-dir>
# Needs Docker (unless DATABASE_URL is set) and playwright from NODE_PATH (default ~/dev/pw-test/node_modules).
set -euo pipefail
OUT=$(mkdir -p "${1:?usage: onboarding-walk.sh <output-dir>}" && cd "$1" && pwd)
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
free_port() { node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }
API_PORT=$(free_port)
WEB_PORT=$(free_port)
SITE_PORT=$(free_port)
DB_NAME=pp-onboarding-walk-$$
PIDS=()
cleanup() {
  # Each service runs in its own process group: pnpm exec does not pass a signal on to its child.
  for pid in "${PIDS[@]}"; do kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  [ -z "${KEEP_DB:-}" ] && [ -z "${OWN_DB:-}" ] && docker rm -f "$DB_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_for() { # url, what
  for _ in $(seq 1 120); do curl -sf -o /dev/null "$1" && return 0; sleep 0.5; done
  echo "$2 did not start; see $OUT/logs" >&2
  exit 1
}

mkdir -p "$OUT/logs"
if [ -n "${DATABASE_URL:-}" ]; then
  OWN_DB=1
else
  docker run -d --name "$DB_NAME" -e POSTGRES_PASSWORD=dev -p 127.0.0.1::5432 postgres:18 >/dev/null
  DB_PORT=$(docker port "$DB_NAME" 5432 | head -1 | sed 's/.*://')
  for _ in $(seq 1 60); do docker exec "$DB_NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 0.5; done
  DATABASE_URL=postgres://postgres:dev@127.0.0.1:$DB_PORT/postgres
fi

(cd "$ROOT/site" && node build.mjs >"$OUT/logs/site-build.log" 2>&1)
setsid python3 -m http.server -b 127.0.0.1 -d "$ROOT/site/dist" "$SITE_PORT" >"$OUT/logs/site.log" 2>&1 &
PIDS+=($!)

(cd "$ROOT/server" && exec setsid env DATABASE_URL="$DATABASE_URL" PORT="$API_PORT" MAIL_PROVIDER=log BOT_CHALLENGE=altcha \
  PUBLIC_URL="http://127.0.0.1:$WEB_PORT" NODE_ENV=development pnpm exec tsx src/main.ts) >"$OUT/logs/server.log" 2>&1 &
PIDS+=($!)

(cd "$ROOT/web" && exec setsid env PLAINPHONE_API_URL="http://127.0.0.1:$API_PORT" \
  pnpm exec vite --port "$WEB_PORT" --strictPort --host 127.0.0.1) >"$OUT/logs/vite.log" 2>&1 &
PIDS+=($!)

wait_for "http://127.0.0.1:$API_PORT/api/health" "the server"
wait_for "http://127.0.0.1:$WEB_PORT/login" "the Vite dev server"
wait_for "http://127.0.0.1:$SITE_PORT/" "the site server"

cd "$ROOT/server"
NODE_PATH=${PLAYWRIGHT_NODE_PATH:-${NODE_PATH:-$HOME/dev/pw-test/node_modules}} \
  SITE_URL="http://127.0.0.1:$SITE_PORT" WEB_URL="http://127.0.0.1:$WEB_PORT" API_URL="http://127.0.0.1:$API_PORT" \
  SERVER_LOG="$OUT/logs/server.log" OUT="$OUT" pnpm exec tsx "$ROOT/web/scripts/onboarding-walk.mjs"
