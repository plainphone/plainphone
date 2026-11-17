#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Usage: scripts/android-release-metadata.sh AAPT2 plainphone-VERSION.apk
set -euo pipefail

python3 - "${1:?aapt2 path required}" "${2:?APK path required}" <<'PY'
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

aapt, filename = sys.argv[1:]
apk = Path(filename)
badging = subprocess.check_output([aapt, "dump", "badging", str(apk)], text=True)
package = next(line for line in badging.splitlines() if line.startswith("package: "))
match = re.search(r"name='org\.plainphone\.app' versionCode='([1-9][0-9]*)' versionName='([^']+)'", package)
if match is None:
    raise SystemExit("Expected a Plainphone APK with versionCode and versionName")

with apk.open("rb") as stream:
    checksum = hashlib.file_digest(stream, "sha256").hexdigest()
metadata = dict(versionCode=int(match[1]), versionName=match[2], sha256=checksum)
apk.with_name(apk.name + ".json").write_text(json.dumps(metadata) + "\n", encoding="utf-8")
PY
