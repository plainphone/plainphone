#!/usr/bin/env python3
"""Supply-chain summary for one harness crate.

Usage: audit_deps.py <crate-dir> [--target <triple>] [--ages]

Prints the licences and build scripts of every package in the resolved build
graph for the host (or the given target). With --ages it asks the crates.io
API for the publish date of EVERY package in Cargo.lock, for all targets, and
flags versions younger than three days. Read-only; changes nothing.
"""
import json
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone


def metadata(crate: str, target: str | None) -> list[dict]:
    cmd = ["cargo", "metadata", "--format-version", "1"]
    if target:
        cmd += ["--filter-platform", target]
    meta = json.loads(subprocess.check_output(cmd, cwd=crate))
    used = {n["id"] for n in meta["resolve"]["nodes"]}
    return [p for p in meta["packages"] if p["id"] in used and p["source"]]


def main() -> int:
    crate = sys.argv[1]
    ages = "--ages" in sys.argv
    target = sys.argv[sys.argv.index("--target") + 1] if "--target" in sys.argv else "x86_64-unknown-linux-gnu"
    pkgs = metadata(crate, target)
    print(f"target: {target}")
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
        everything = metadata(crate, None)
        print(f"age check over all {len(everything)} packages in Cargo.lock (every target)")
        for p in sorted(everything, key=lambda p: p["name"]):
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
