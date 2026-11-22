#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Generate the Xcode project, build the dev host with its extensions for the simulator, and run
# the PlainphoneCore unit tests. Unsigned. Used by the `ios` job in .github/workflows/ci.yml and
# on a Mac with Xcode 26 and xcodegen: ios/scripts/ci.sh
set -euo pipefail
cd "$(dirname "$0")/.."

xcodegen generate --spec project.yml

destination=$(xcrun simctl list devices available --json | python3 scripts/pick-simulator.py)
echo "Destination: $destination"

xcodebuild test \
  -project PlainphoneDev.xcodeproj \
  -scheme PlainphoneDev \
  -destination "$destination" \
  -derivedDataPath build/DerivedData \
  -resultBundlePath build/PlainphoneDev.xcresult \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  -quiet
