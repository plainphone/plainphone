# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Plainphone authors
"""Fixed exceptions, sourced from the same verified catalogue as the phone."""
import json
from pathlib import Path

CATALOGUE = Path(__file__).resolve().parents[1] / "helpline-catalogue"
if not CATALOGUE.is_dir():
    CATALOGUE = Path(__file__).resolve().parents[2] / "server/catalog/helplines"


def domains() -> list[str]:
    domains = set()
    files = sorted(CATALOGUE.glob("*.json"))
    if not files:
        raise RuntimeError("Protected help-site catalogue is missing")
    for path in files:
        data = json.loads(path.read_text(encoding="utf-8"))
        for entry in data["helplines"] + data["information"]:
            domains.update(entry["domains"])
    return sorted(domains)
