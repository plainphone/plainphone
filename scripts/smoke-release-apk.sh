#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Smoke test of a minified release APK without an emulator. R8 renames and removes code, so
# check what the platform looks up by name:
#   - every component in the manifest (activities, receivers, services, the device admin) exists in the dex,
#   - WorkManager's workers keep their names and (Context, WorkerParameters) constructors
#     (WorkManager stores the class name, so an update must still find queued work),
#   - enum constants whose names are written to storage keep those names,
#   - the signature verifies, and its checksum is printed for the QR code.
# Usage: scripts/smoke-release-apk.sh <app-github-release.apk> [expected-checksum | --unsigned]
# Needs ANDROID_HOME with build-tools (aapt2, apksigner, dexdump).
set -euo pipefail

apk="$1"
expected="${2:-}"
bt="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# --unsigned: the Play release built without an upload key (scripts/smoke-play-apk.sh).
if [[ "$expected" == "--unsigned" ]]; then
  echo "unsigned APK: signature not checked"
else
  "$bt/apksigner" verify --print-certs "$apk" >"$work/certs"
  digest="$(grep -m1 -oP 'certificate SHA-256 digest: \K[0-9a-f]{64}' "$work/certs")"
  checksum="$(echo "$digest" | xxd -r -p | base64 | tr '+/' '-_' | tr -d '=')"
  echo "signature checksum: $checksum"
  if [[ -n "$expected" && "$checksum" != "$expected" ]]; then
    echo "FAIL: expected checksum $expected" >&2
    exit 1
  fi
fi

pkg="org.plainphone.app"
"$bt/aapt2" dump xmltree --file AndroidManifest.xml "$apk" >"$work/manifest"
# android:name of application, activity, activity-alias targets, receiver, service, provider.
grep -A2 -E 'E: (application|activity|receiver|service|provider) ' "$work/manifest" \
  | grep -oP 'A: http://schemas.android.com/apk/res/android:name\(0x01010003\)="\K[^"]+' \
  | sed "s/^\./$pkg./" | grep "^$pkg\." | sort -u >"$work/components"

unzip -q -o "$apk" 'classes*.dex' -d "$work/dex"
for dex in "$work"/dex/classes*.dex; do "$bt/dexdump" "$dex"; done >"$work/dump" 2>/dev/null
grep -oP "Class descriptor  : 'L\K[^;]+" "$work/dump" | tr / . | sort -u >"$work/classes"

missing=0
while read -r c; do
  if ! grep -qx "$c" "$work/classes"; then
    echo "FAIL: manifest component missing from dex: $c" >&2
    missing=1
  fi
done <"$work/components"
echo "manifest components found in dex: $(wc -l <"$work/components")"

for worker in "$pkg.sync.SyncWorker" "$pkg.sync.EnrollWorker"; do
  if ! grep -qx "$worker" "$work/classes"; then
    echo "FAIL: worker renamed or removed: $worker" >&2
    missing=1
    continue
  fi
  # The constructor WorkManager calls by reflection.
  if ! awk -v c="L${worker//./\/};" '$0 ~ "Class descriptor  : .*"c {f=1} f && /Class descriptor/ && $0 !~ c {f=0} f' "$work/dump" \
      | grep -q "(Landroid/content/Context;Landroidx/work/WorkerParameters;)V"; then
    echo "FAIL: $worker lost its (Context, WorkerParameters) constructor" >&2
    missing=1
  fi
done

# The classes may be renamed; the constant names (what name() returns and valueOf reads) may not.
for constant in CALL SMS INCOMING OUTGOING; do
  grep -qE "name +: '$constant'" "$work/dump" || { echo "FAIL: stored enum constant renamed: $constant" >&2; missing=1; }
done

[[ $missing -eq 0 ]] || exit 1
echo "release APK smoke test passed ($(du -h "$apk" | cut -f1))"
