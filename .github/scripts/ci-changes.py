#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Select CI checks from the tree diff for the commits of this run."""

import os
import subprocess
import sys
from fnmatch import fnmatchcase

WORKFLOWS = (".github/workflows/*", ".github/scripts/*")
WORKSPACE_ROOT = ("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", "patches/*")
WORKSPACE = WORKSPACE_ROOT + ("packages/*",)
# Turborepo's task graph and cache inputs; only the jobs that run through Turborepo use it.
TURBO = ("turbo.json",)
# Code the web dashboard and the parent app share. The server and the phone never import it.
CLIENT_PACKAGES = ("packages/i18n/*", "packages/shared/*", "packages/api-client/*")
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
    "server": WORKSPACE + TURBO + CRYPTO_VECTORS + (
        "server/*", "web/*", "Dockerfile", ".dockerignore",
        # test/env-wiring.test.ts checks the app's environment in these against src/config.ts.
        "compose.yaml", "deploy/dokploy-compose.yaml", ".env.example", "docs/self-hosting.md",
        # The Swift tests' rules fixture, checked against the server (test/ios-contract.test.ts).
        "ios/Tests/Fixtures/*",
    ),
    # The app is in the root workspace: its lockfile, the shared packages and the spec they type.
    "parent": WORKSPACE_ROOT + TURBO + CLIENT_PACKAGES + ("parent-app/*", "server/openapi.yaml"),
    "dns": ("dns/*", "server/catalog/helplines/*", "server/src/db/schema.ts", "server/src/lib/validation.ts"),
    # site/scripts/privacy.test.mjs reads the parent app's tile host and map button labels.
    "site": ("site/*", "server/catalog/??.json", "parent-app/src/i18n/app-??.ts", "parent-app/src/lib/tiles.ts"),
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

# Paths a check ignores although one of its patterns matches them.
IGNORED = {"e2e": CLIENT_PACKAGES, "emulator": CLIENT_PACKAGES}

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
                any(fnmatchcase(path, pattern) for pattern in WORKFLOWS + patterns)
                and not any(fnmatchcase(path, pattern) for pattern in IGNORED.get(check, ()))
                for path in paths
            )
        print(f"{check}={str(changed).lower()}", file=output)
