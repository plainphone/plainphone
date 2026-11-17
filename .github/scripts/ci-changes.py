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
    "server": WORKSPACE + CRYPTO_VECTORS + (
        "server/*", "web/*", "Dockerfile", ".dockerignore",
    ),
    "parent": (
        "parent-app/*",
        "server/openapi.yaml",
        "web/src/i18n/*",
        "web/src/lib/format.ts",
        "web/src/lib/failedPolicies.ts",
        "web/src/lib/ops.ts",
        "web/src/lib/settings.ts",
    ),
    "dns": ("dns/*", "server/catalog/helplines/*", "server/src/db/schema.ts", "server/src/lib/validation.ts"),
    "site": ("site/*",),
}

base, head = sys.argv[1:]
# A push can lack a usable predecessor, for example after a force push.
if base == "all":
    paths = None
else:
    diff = subprocess.check_output(
        ["git", "diff", "--name-only", "--no-renames", "-z", base, head, "--"]
    )
    paths = os.fsdecode(diff).split("\0")[:-1]

with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
    for check, patterns in FILTERS.items():
        changed = paths is None or any(
            fnmatchcase(path, pattern) for path in paths for pattern in WORKFLOWS + patterns
        )
        print(f"{check}={str(changed).lower()}", file=output)
