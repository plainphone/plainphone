#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Smoke test of the Google Play edition's minified release APK (docs/play/play-edition.md):
#   - the checks in smoke-release-apk.sh (components, workers and stored enum names survive R8),
#   - what Google Play forbids is not in the manifest: QUERY_ALL_PACKAGES, REQUEST_INSTALL_PACKAGES,
#     the systemExempted install watchdog, Device Owner provisioning,
#   - what it asks for is: isMonitoringTool = child_monitoring and <queries> for launcher apps,
#   - the self-updater's code and the link to the APK download are not in the dex.
# Usage: scripts/smoke-play-apk.sh <app-play-release[-unsigned].apk>
# Needs ANDROID_HOME with build-tools (aapt2, apksigner, dexdump).
set -euo pipefail

apk="$1"
here="$(cd "$(dirname "$0")" && pwd)"
if [[ "$apk" == *-unsigned.apk ]]; then
  "$here/smoke-release-apk.sh" "$apk" --unsigned
else
  "$here/smoke-release-apk.sh" "$apk"
fi

bt="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
"$bt/aapt2" dump xmltree --file AndroidManifest.xml "$apk" >"$work/manifest"
unzip -q -o "$apk" 'classes*.dex' -d "$work/dex"
# -d disassembles, so string constants are in the dump too.
for dex in "$work"/dex/classes*.dex; do "$bt/dexdump" -d "$dex"; done >"$work/dump" 2>/dev/null

failed=0
fail() {
  echo "FAIL: $1" >&2
  failed=1
}

for forbidden in \
  android.permission.QUERY_ALL_PACKAGES \
  android.permission.REQUEST_INSTALL_PACKAGES \
  android.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED \
  android.app.action.GET_PROVISIONING_MODE \
  android.app.action.ADMIN_POLICY_COMPLIANCE \
  android.app.action.PROVISIONING_SUCCESSFUL \
  org.plainphone.app.update.InstallWatchdogService; do
  if grep -q "\"$forbidden\"" "$work/manifest"; then fail "the Play manifest has $forbidden"; fi
done

grep -A2 'E: meta-data' "$work/manifest" | grep -q '"isMonitoringTool"' || fail "isMonitoringTool is not declared"
grep -A2 'E: meta-data' "$work/manifest" | grep -q '"child_monitoring"' || fail "isMonitoringTool is not child_monitoring"
grep -A12 'E: queries' "$work/manifest" | grep -q '"android.intent.category.LAUNCHER"' || fail "no <queries> for launcher apps"

# Class names survive R8 only for kept classes, so look for the code by what it does as well.
if grep -q "Class descriptor  : 'Lorg/plainphone/app/update/SelfUpdater;'" "$work/dump"; then fail "SelfUpdater is in the dex"; fi
if grep -q '/download/android' "$work/dump"; then fail "a link to /download/android is in the dex"; fi
if grep -q 'latest.json' "$work/dump"; then fail "the update check (latest.json) is in the dex"; fi

[[ $failed -eq 0 ]] || exit 1
echo "Play APK smoke test passed"
