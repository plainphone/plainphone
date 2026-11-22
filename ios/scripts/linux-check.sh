#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Build and test PlainphoneCore without a Mac, in the official Swift container. The Apple-only
# parts (FamilyControlsApplier, the extensions, the dev host) are left out by `#if canImport`, so
# this checks the logic, not the Family Controls calls; the `ios` CI job on macOS checks those.
# Runs in Swift 5 mode (as the Expo pod builds it) and Swift 6 mode with warnings as errors.
#   ios/scripts/linux-check.sh            # needs Docker
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'docker run --rm -v "$work":/work swift:6.2 rm -rf /work/.build >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

cat > "$work/Package.swift" <<'SWIFT'
// swift-tools-version:6.0
import PackageDescription

let package = Package(
  name: "PlainphoneCoreCheck",
  targets: [
    .target(name: "PlainphoneCore", path: "repo/parent-app/modules/plainphone-screentime/ios/Core"),
    .testTarget(name: "PlainphoneCoreTests", dependencies: ["PlainphoneCore"], path: "repo/ios/Tests/PlainphoneCoreTests"),
  ]
)
SWIFT

docker run --rm -v "$work":/work -v "$repo":/work/repo:ro -w /work swift:6.2 bash -c '
  set -euo pipefail
  swift build --build-tests -Xswiftc -swift-version -Xswiftc 5
  swift test --skip-build
  rm -rf .build
  swift build --build-tests -Xswiftc -warnings-as-errors
  swift test --skip-build
'
