#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Builds the OpenMLS core for the phone app's DEBUG prototype build (docs/e2ee-prototype.md):
# libplainphone_mls.so for arm64-v8a with the JNI entry point, into target/jniLibs, where
# `./gradlew assembleDebug -PplainphoneE2eePrototype=true` picks it up. Release builds never
# package it.
#
# Needs the aarch64-linux-android Rust target and an Android NDK (ANDROID_NDK_HOME,
# ANDROID_NDK_LATEST_HOME, or the newest one under $ANDROID_HOME/ndk or ~/android-sdk/ndk).
set -euo pipefail

crate="$(cd "$(dirname "$0")/.." && pwd)"
sdk="${ANDROID_HOME:-$HOME/android-sdk}"
ndk="${ANDROID_NDK_HOME:-${ANDROID_NDK_LATEST_HOME:-$(ls -d "$sdk"/ndk/* | sort -V | tail -1)}}"
clang="$(ls "$ndk"/toolchains/llvm/prebuilt/*/bin/aarch64-linux-android29-clang)"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$clang"
export CC_aarch64_linux_android="$clang"
export AR_aarch64_linux_android="$(dirname "$clang")/llvm-ar"

cd "$crate"
cargo build --locked --release --lib --features jni --target aarch64-linux-android
mkdir -p target/jniLibs/arm64-v8a
cp target/aarch64-linux-android/release/libplainphone_mls.so target/jniLibs/arm64-v8a/
size=$(wc -c < target/jniLibs/arm64-v8a/libplainphone_mls.so)
gz=$(gzip -9c target/jniLibs/arm64-v8a/libplainphone_mls.so | wc -c)
echo "arm64-v8a libplainphone_mls.so: $size bytes ($gz gzip)"
