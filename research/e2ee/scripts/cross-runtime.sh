#!/usr/bin/env bash
# Cross-runtime OpenMLS check: the native binary and the wasm32 build (run in
# Node through wasm-bindgen) create, join, read and answer each other's group.
# Runs both directions. Needs cargo, the wasm32-unknown-unknown target,
# wasm-bindgen-cli 0.2.130 on PATH and Node 24. No network.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
cd "$here/mls-harness"

cargo build --release --quiet --locked
cargo build --release --quiet --locked --lib --target wasm32-unknown-unknown
wasm-bindgen --target nodejs --out-dir target/wasm-node \
  target/wasm32-unknown-unknown/release/mls_harness.wasm 2>/dev/null

native() { ./target/release/mls-harness cross "$work" "$@"; }
wasm() { node "$here/scripts/run-wasm-step.mjs" target/wasm-node/mls_harness.js "$work" "$@"; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "== native parent creates, wasm child joins"
native keygen parent-a-phone
wasm keygen child-phone
native create parent-a-phone child-phone
wasm reply child-phone parent-a-phone
native read parent-a-phone

rm -rf "${work:?}"/*
echo "== wasm parent creates, native child joins"
wasm keygen parent-a-phone
native keygen child-phone
wasm create parent-a-phone child-phone
native reply child-phone parent-a-phone
wasm read parent-a-phone

echo "== sizes (bytes): native binary, wasm-bindgen module, gzip of the module"
stat -c %s target/release/mls-harness target/wasm-node/mls_harness_bg.wasm
gzip -9c target/wasm-node/mls_harness_bg.wasm | wc -c
