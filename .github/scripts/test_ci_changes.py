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
CHECKS = {"android", "e2e", "server", "parent", "dns", "site"}


class ChangeDetectionTests(unittest.TestCase):
    def test_changed_paths(self):
        cases = {
            "packages/crypto/index.ts": {"android", "server", "e2e"},
            "packages/crypto-vectors/vectors.ts": {"android", "server", "e2e"},
            "packages/other/index.ts": {"server", "e2e"},
            "docs/encryption-test-vectors/primitives.json": {"android", "server"},
            "docs/encryption-test-vectors/protocol.json": {"android", "server"},
            "pnpm-lock.yaml": {"server", "e2e"},
            "server/openapi.yaml": {"server", "e2e", "parent"},
            "web/src/lib/settings.ts": {"server", "parent"},
            "web/test-fixtures/light-setup-intent.txt": {"android", "server"},
            "server/catalog/dk.json": {"server", "e2e"},
            "dns/ppdns/profiles.py": {"dns"},
            "server/src/db/schema.ts": {"server", "e2e", "dns"},
            "server/src/lib/validation.ts": {"server", "e2e", "dns"},
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
