#!/usr/bin/env python3
"""Supply-chain summary for one harness crate.

Usage: audit_deps.py <crate-dir> [--ages]

Prints every package in the resolved (host, default-feature) build graph with
its licence and whether it has a build script. With --ages it also asks the
crates.io API for each version's publish date and flags versions younger than
three days. Read-only; makes no change to the crate.
"""
import json
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone


def main() -> int:
    crate = sys.argv[1]
    ages = "--ages" in sys.argv
    meta = json.loads(
        subprocess.check_output(
            ["cargo", "metadata", "--format-version", "1", "--filter-platform", "x86_64-unknown-linux-gnu"],
            cwd=crate,
        )
    )
    used = {n["id"] for n in meta["resolve"]["nodes"]}
    pkgs = [p for p in meta["packages"] if p["id"] in used and p["source"]]
    now = datetime.now(timezone.utc)
    licences: dict[str, int] = {}
    build_scripts = []
    young = []
    for p in sorted(pkgs, key=lambda p: p["name"]):
        lic = p.get("license") or "?"
        licences[lic] = licences.get(lic, 0) + 1
        if any("custom-build" in t["kind"] for t in p["targets"]):
            build_scripts.append(f"{p['name']}@{p['version']}")
        if ages:
            req = urllib.request.Request(
                f"https://crates.io/api/v1/crates/{p['name']}/{p['version']}",
                headers={"User-Agent": "plainphone-research-audit"},
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                created = json.load(r)["version"]["created_at"]
            when = datetime.fromisoformat(created.replace("Z", "+00:00"))
            days = (now - when).days
            if days < 3:
                young.append(f"{p['name']}@{p['version']} ({days} d)")
            time.sleep(1.0)
    print(f"packages: {len(pkgs)}")
    print("licences:")
    for lic, n in sorted(licences.items(), key=lambda kv: -kv[1]):
        print(f"  {n:4d}  {lic}")
    print(f"build scripts ({len(build_scripts)}): {', '.join(build_scripts)}")
    if ages:
        print(f"younger than 3 days: {', '.join(young) or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
