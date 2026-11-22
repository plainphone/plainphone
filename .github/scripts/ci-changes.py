#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Select CI checks from the tree diff for the commits of this run."""

import os
import subprocess
import sys
from fnmatch import fnmatchcase

WORKFLOWS = (".github/workflows/*", ".github/scripts/*")
WORKSPACE = ("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", "patches/*", "packages/*")
CRYPTO_VECTORS = ("docs/encryption-test-vectors/*",)
ANDROID = (
    "android/*",
    "server/catalog/helplines/*",
    "scripts/provisioning-qr.py",
    "scripts/test_provisioning_qr.py",
    "scripts/smoke-release-apk.sh",
)
FILTERS = {
    "android": ANDROID + CRYPTO_VECTORS + ("packages/crypto*", "web/test-fixtures/*"),
    "e2e": ANDROID + WORKSPACE + ("server/*", "scripts/e2e-phone-sync.sh"),
    "emulator": WORKSPACE + (
        "android/*", "server/*", "scripts/e2e-android-emulator.py", "scripts/test_e2e_android_emulator.py",
    ),
    "server": WORKSPACE + CRYPTO_VECTORS + (
        "server/*", "web/*", "Dockerfile", ".dockerignore",
        # The Swift tests' rules fixture, checked against the server (test/ios-contract.test.ts).
        "ios/Tests/Fixtures/*",
    ),
    "parent": (
        "parent-app/*",
        "server/openapi.yaml",
        "web/src/i18n/*",
        "web/src/lib/format.ts",
        "web/src/lib/failedPolicies.ts",
        "web/src/lib/lock-steps.ts",
        "web/src/lib/phone-language.ts",
        "web/src/lib/phoneUpdate.ts",
        "web/src/lib/ops.ts",
        "web/src/lib/settings.ts",
    ),
    "dns": ("dns/*", "server/catalog/helplines/*", "server/src/db/schema.ts", "server/src/lib/validation.ts"),
    "site": ("site/*", "server/catalog/??.json"),
    # E2EE phase 0 prototype: only what the Rust core, its Android binding and the demo touch.
    "e2ee": CRYPTO_VECTORS + (
        "e2ee/*", "packages/crypto*",
        "server/src/routes/e2ee*", "server/src/lib/e2ee*", "server/src/lib/mls-*",
        "server/src/services/e2ee*", "server/src/db/e2ee-schema.ts",
        "server/drizzle/*e2ee*", "server/test/e2ee*", "server/test/e2e/e2ee-*",
        "scripts/e2ee-prototype-demo.sh", "android/app/build.gradle.kts",
        "android/app/src/debug/java/org/plainphone/app/e2ee/*", "android/app/src/testDebug/*",
    ),
    "ios": ("ios/*", "parent-app/modules/plainphone-screentime/*"),
    "backup": (
        "compose.yaml", "deploy/dokploy-compose.yaml", "deploy/backup.Dockerfile*",
        "scripts/backup*.sh", "scripts/restore-backup.sh", "scripts/restore-service.py",
        "scripts/test-offsite-backup.sh", "scripts/backup-test/*",
    ),
}

base, head = sys.argv[1:]
# A push can lack a usable predecessor, for example after a force push.
if base in ("all", "nightly"):
    paths = None
else:
    diff = subprocess.check_output(
        ["git", "diff", "--name-only", "--no-renames", "-z", base, head, "--"]
    )
    paths = os.fsdecode(diff).split("\0")[:-1]

with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
    for check, patterns in FILTERS.items():
        if base == "nightly":
            # The scheduled run on main covers only the prototype; the other checks run on every merge.
            changed = check == "e2ee"
        else:
            changed = paths is None or any(
                fnmatchcase(path, pattern) for path in paths for pattern in WORKFLOWS + patterns
            )
        print(f"{check}={str(changed).lower()}", file=output)
