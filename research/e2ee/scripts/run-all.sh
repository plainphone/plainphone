#!/usr/bin/env bash
# Run every E2EE experiment for issue #120: the OpenMLS scenarios, the
# vodozemac (Matrix model) scenarios, the matrix-sdk-crypto probe, the
# cross-runtime OpenMLS check and the size builds. Synthetic data only, no
# network once the crates are fetched. Not part of CI: it needs Rust, the
# wasm32 and Android targets, wasm-bindgen-cli 0.2.130, the NDK and Node 24,
# and takes a few minutes. See ../README.md.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"

for crate in mls-harness matrix-harness matrix-sdk-probe; do
  echo "=== $crate"
  (cd "$here/$crate" && cargo build --release --quiet --locked && "./target/release/$crate")
done

echo "=== cross-runtime (native <-> wasm32 in Node)"
"$here/scripts/cross-runtime.sh"

echo "=== sizes"
"$here/scripts/sizes.sh"
