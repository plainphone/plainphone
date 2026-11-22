# SPDX-License-Identifier: Apache-2.0

import os
import runpy
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

DETECTOR = Path(__file__).with_name("ci-changes.py")
CHECKS = {"android", "e2e", "emulator", "server", "parent", "dns", "site", "backup", "ios", "e2ee"}


class ChangeDetectionTests(unittest.TestCase):
    def test_changed_paths(self):
        cases = {
            "packages/crypto/index.ts": {"android", "server", "e2e", "emulator", "e2ee"},
            "packages/crypto-vectors/vectors.ts": {"android", "server", "e2e", "emulator", "e2ee"},
            "packages/other/index.ts": {"server", "e2e", "emulator"},
            "docs/encryption-test-vectors/primitives.json": {"android", "server", "e2ee"},
            "docs/encryption-test-vectors/protocol.json": {"android", "server", "e2ee"},
            "docs/encryption-test-vectors/mls-prototype.json": {"android", "server", "e2ee"},
            "pnpm-lock.yaml": {"server", "e2e", "emulator"},
            "server/openapi.yaml": {"server", "e2e", "emulator", "parent"},
            "web/src/lib/settings.ts": {"server", "parent"},
            "web/src/lib/failedPolicies.ts": {"server", "parent"},
            "web/test-fixtures/light-setup-intent.txt": {"android", "server"},
            "server/catalog/dk.json": {"server", "e2e", "emulator", "site"},
            "server/catalog/helplines/dk.json": {"android", "server", "e2e", "emulator", "dns"},
            "dns/ppdns/profiles.py": {"dns"},
            "server/src/db/schema.ts": {"server", "e2e", "emulator", "dns"},
            "server/src/lib/validation.ts": {"server", "e2e", "emulator", "dns"},
            "android/app/build.gradle.kts": {"android", "e2e", "emulator", "e2ee"},
            "android/app/src/debug/java/org/plainphone/app/e2ee/MlsCore.kt": {"android", "e2e", "emulator", "e2ee"},
            "e2ee/mls-core/src/client.rs": {"e2ee"},
            "scripts/e2ee-prototype-demo.sh": {"e2ee"},
            "server/src/routes/e2ee.ts": {"server", "e2e", "emulator", "e2ee"},
            "server/src/db/e2ee-schema.ts": {"server", "e2e", "emulator", "e2ee"},
            "server/drizzle/0058_e2ee_prototype.sql": {"server", "e2e", "emulator", "e2ee"},
            "server/test/e2e/e2ee-demo.ts": {"server", "e2e", "emulator", "e2ee"},
            "server/src/routes/device.ts": {"server", "e2e", "emulator"},
            "deploy/backup.Dockerfile": {"backup"},
            "scripts/backup-test/storage.py": {"backup"},
            "compose.yaml": {"backup"},
            "scripts/e2e-android-emulator.py": {"emulator"},
            "scripts/test_e2e_android_emulator.py": {"emulator"},
            ".github/workflows/ci.yml": CHECKS,
            "ios/project.yml": {"ios"},
            "ios/Tests/Fixtures/ios-rules.json": {"ios", "server"},
            "parent-app/modules/plainphone-screentime/ios/Core/RulesCompiler.swift": {"ios", "parent"},
            "parent-app/src/app/index.tsx": {"parent"},
            "README.md": set(),
            ".github/scripts/ci-changes.py": CHECKS,
        }
        for path, expected in cases.items():
            with self.subTest(path=path), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "output"
                with (
                    patch.object(sys, "argv", [str(DETECTOR), "base", "head"]),
                    patch.dict(os.environ, {"GITHUB_OUTPUT": str(output)}),
                    patch.object(subprocess, "check_output", return_value=os.fsencode(path) + b"\0"),
                ):
                    runpy.run_path(str(DETECTOR), run_name="__main__")
                self.assertCountEqual(
                    output.read_text(encoding="utf-8").splitlines(),
                    [f"{check}={'true' if check in expected else 'false'}"
                     for check in CHECKS],
                )

    def test_nightly_run_checks_only_the_prototype(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "output"
            with (
                patch.object(sys, "argv", [str(DETECTOR), "nightly", "head"]),
                patch.dict(os.environ, {"GITHUB_OUTPUT": str(output)}),
            ):
                runpy.run_path(str(DETECTOR), run_name="__main__")
            self.assertCountEqual(
                output.read_text(encoding="utf-8").splitlines(),
                [f"{check}={'true' if check == 'e2ee' else 'false'}" for check in CHECKS],
            )
