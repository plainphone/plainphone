#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Print an xcodebuild destination for the newest available iPhone simulator on iOS 26 or later.

Reads `xcrun simctl list devices available --json` from stdin, so it is testable without Xcode:
    xcrun simctl list devices available --json | python3 ios/scripts/pick-simulator.py
"""

import json
import re
import sys

MIN_MAJOR = 26


def runtime_version(key: str) -> tuple[int, ...] | None:
    match = re.fullmatch(r"com\.apple\.CoreSimulator\.SimRuntime\.iOS-(\d+(?:-\d+)*)", key)
    return tuple(int(part) for part in match.group(1).split("-")) if match else None


def pick(listing: dict) -> str | None:
    best = None
    for key, devices in listing.get("devices", {}).items():
        version = runtime_version(key)
        if version is None or version[0] < MIN_MAJOR:
            continue
        for device in devices:
            if not device.get("isAvailable", True) or not device.get("name", "").startswith("iPhone"):
                continue
            # Newest runtime first; then the plainest name ("iPhone 17" before "iPhone 17 Pro Max").
            rank = (version, -len(device["name"]))
            if best is None or rank > best[0]:
                best = (rank, device["udid"])
    return f"platform=iOS Simulator,id={best[1]}" if best else None


if __name__ == "__main__":
    destination = pick(json.load(sys.stdin))
    if destination is None:
        sys.exit(f"No available iPhone simulator on iOS {MIN_MAJOR} or later.")
    print(destination)
