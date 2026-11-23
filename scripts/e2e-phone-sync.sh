#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# End-to-end test of the phone sync without an emulator: starts the real server
# (with DATABASE_URL, or an embedded PostgreSQL) and runs PhoneSyncContractTest,
# in which the phone's own Kotlin code pairs, syncs rules, answers "Find" and
# reports its status over HTTP. Needs node/pnpm (repo root `pnpm install` done)
# and the Android SDK + JDK 21 like the Android build.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
fixture="$work/fixture.json"
log="$work/server.log"
export PORT="${PORT:-18080}"

cleanup() {
  if [[ -n "${server_pid:-}" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid"
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

(cd "$root/server" && exec node --import tsx test/e2e/phone-sync-server.ts "$fixture") >"$log" 2>&1 &
server_pid=$!

for _ in $(seq 1 120); do
  [[ -s "$fixture" ]] && break
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "server did not start:" >&2
    cat "$log" >&2
    exit 1
  fi
  sleep 1
done
if [[ ! -s "$fixture" ]]; then
  echo "server not ready after 120 s:" >&2
  cat "$log" >&2
  exit 1
fi

cd "$root/android"
PLAINPHONE_E2E="$fixture" ./gradlew --no-daemon testGithubDebugUnitTest \
  --tests 'org.plainphone.app.sync.PhoneSyncContractTest' --rerun

# The test is skipped (not failed) without PLAINPHONE_E2E, so make sure it really ran.
report="app/build/test-results/testGithubDebugUnitTest/TEST-org.plainphone.app.sync.PhoneSyncContractTest.xml"
grep -q 'tests="6" skipped="0" failures="0" errors="0"' "$report" || {
  echo "PhoneSyncContractTest did not run cleanly:" >&2
  head -c 4000 "$report" >&2
  exit 1
}
echo "phone sync and SOS end-to-end test passed"
