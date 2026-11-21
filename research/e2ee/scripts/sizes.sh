#!/usr/bin/env bash
# Build both harness libraries for Android arm64 (API 29), wasm32 and the host
# and print their sizes and their C-ABI self-test result on the host. The
# Android .so files are measured only; running them needs a real device.
# Needs the Android NDK (ANDROID_NDK_HOME or ~/android-sdk/ndk/<version>) and
# the aarch64-linux-android and wasm32-unknown-unknown Rust targets.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
ndk="${ANDROID_NDK_HOME:-$(ls -d "$HOME"/android-sdk/ndk/* | sort -V | tail -1)}"
clang="$(ls "$ndk"/toolchains/llvm/prebuilt/*/bin/aarch64-linux-android29-clang)"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$clang"
export CC_aarch64_linux_android="$clang"
export AR_aarch64_linux_android="$(dirname "$clang")/llvm-ar"

for crate in mls-harness matrix-harness matrix-sdk-probe; do
  lib="${crate//-/_}"
  (cd "$here/$crate"
    cargo build --release --quiet --locked --lib --target aarch64-linux-android
    cargo build --release --quiet --locked --lib --target wasm32-unknown-unknown
    cargo build --release --quiet --locked --lib
    so="target/aarch64-linux-android/release/lib$lib.so"
    wasm="target/wasm32-unknown-unknown/release/$lib.wasm"
    printf '%s android-arm64 .so: %s bytes (gzip %s)\n' "$crate" "$(stat -c %s "$so")" "$(gzip -9c "$so" | wc -c)"
    printf '%s wasm32 module:     %s bytes (gzip %s)\n' "$crate" "$(stat -c %s "$wasm")" "$(gzip -9c "$wasm" | wc -c)"
  )
done

# Host self-test through the same C ABI the Android build exports.
probe="$(mktemp -d)"
trap 'rm -rf "$probe"' EXIT
cat > "$probe/probe.py" <<'PY'
import ctypes, sys
for path, sym in zip(sys.argv[1::2], sys.argv[2::2]):
    rc = getattr(ctypes.CDLL(path), sym)()
    print(f"{sym}() on host: {'ok' if rc == 0 else 'FAILED'}")
    if rc != 0:
        sys.exit(1)
PY
python3 -I "$probe/probe.py" \
  "$here/mls-harness/target/release/libmls_harness.so" plainphone_mls_selftest \
  "$here/matrix-harness/target/release/libmatrix_harness.so" plainphone_matrix_selftest \
  "$here/matrix-sdk-probe/target/release/libmatrix_sdk_probe.so" plainphone_matrix_sdk_selftest
