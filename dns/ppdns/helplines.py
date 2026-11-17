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


_BEGIN = "! Plainphone protected help sites"
_END = "! End Plainphone protected help sites"


# The first catalogue wrote unmarked rules. Recognize those exact rules on
# existing installs and in backups without claiming other administrator rules.
_LEGACY_DOMAINS = {
    "backop.dk", "bornetelefonen.dk", "cyberhus.dk", "headspace.dk", "lgbt.dk",
    "livslinien.dk", "politi.dk", "regionh.dk", "regionsjaelland.dk", "regionsyddanmark.dk",
    "rn.dk", "sexlinien.dk", "sexogsamfund.dk", "sundhed.dk", "sundhed.rm.dk", "ungekontakten.aarhus.dk",
}


def filter_rules(domains: list[str]) -> list[str]:
    return [_BEGIN, *(f"@@||{domain}^$important" for domain in domains), _END]


def split_rules(rules: list[str]) -> tuple[list[str], set[str]]:
    kept = []
    previous = set()
    managed = False
    for rule in rules:
        if rule == _BEGIN:
            managed = True
        elif rule == _END:
            managed = False
        else:
            if rule.startswith("@@||") and rule.endswith("^$important"):
                domain = rule.removeprefix("@@||").removesuffix("^$important")
                if managed or domain in _LEGACY_DOMAINS:
                    previous.add(domain)
                    continue
            kept.append(rule)
    return kept, previous
