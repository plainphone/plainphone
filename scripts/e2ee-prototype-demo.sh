#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# E2EE phase 0 prototype demo (docs/e2ee-prototype.md). Builds the OpenMLS core's CLI
# (e2ee/mls-core, `pp-mls`), runs its self-test, then starts the real server with
# E2EE_PROTOTYPE_ENABLED=true (DATABASE_URL, or an embedded PostgreSQL) and drives four
# synthetic devices through the delivery service: a household group of two parents and a
# child, adding and removing a member, key rotation, a commit race, a stale send and texts
# end to end. Needs Rust (cargo) and node/pnpm with `pnpm install` done in the repo root.
# Test data only; nothing here talks to a real service.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

(cd "$root/e2ee/mls-core" && cargo build --locked --release --bin pp-mls)
cli="$root/e2ee/mls-core/target/release/pp-mls"
"$cli" selftest

cd "$root/server"
node --import tsx test/e2e/e2ee-demo.ts "$cli"
