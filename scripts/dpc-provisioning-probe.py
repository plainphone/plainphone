#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Plainphone authors
"""Does Google Play Protect block QR setup of Plainphone as Device Owner? (issue #255)

Boots a Google Play emulator image straight into the setup wizard, opens the QR reader with
six taps on the welcome screen, and lets the wizard scan the same QR code a parent would show.
The back camera renders the QR image (`-camera-back imagefile:`), so the scan, the download of
the release APK, Play Protect's check and Android's managed provisioning are the real ones.
It first checks that the image has Google's setup wizard at all: the SDK's Google Play images
checked so far (API 34 to 37) do not, and then the run stops without a conclusion.
See docs/testing.md, "DPC provisioning probe", for what differs from a real phone.

  fetch --out DIR [--tag vX.Y.Z]   download the newest release APK and check it against .apk.json
  canvas QR.txt OUT.png            draw `qrencode -t ASCII` output on a 4:3 white camera frame
  run --avd NAME --qr PNG --release DIR/release.json --out DIR
                                   boot, provision, write result.json; exit 1 without a conclusion
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

PACKAGE = "org.plainphone.app"
REPO = os.environ.get("GITHUB_REPOSITORY", "plainphone/plainphone")
# The six-tap QR reader is part of Google's setup wizard. SDK emulator images ship the emulator's
# own setup stub (com.google.android.googlesdksetup) instead, which marks the device provisioned at
# first boot and has no QR reader (docs/testing.md, "Why the emulator has no QR path").
GOOGLE_SETUP_WIZARD = "com.google.android.setupwizard"

# Conclusions that answer the question. Anything else fails the job.
CONCLUSIVE = {"provisioned", "provisioned_after_warning", "blocked_by_play_protect"}

# Screen texts, matched case-insensitively. The emulator runs in en-US.
BLOCK_TEXTS = ("app blocked to protect your device", "blocked by play protect", "play protect blocked",
               "harmful app blocked", "this app was blocked", "blocked to protect")
# A bare "Play Protect" is not enough: wizard screens mention it without any warning.
WARNING_TEXTS = ("unsafe app", "can request access to sensitive data", "install anyway",
                 "send app for", "app scan", "potentially harmful")
ERROR_TEXTS = ("can't set up device", "couldn't set up", "couldn't download", "couldn't be downloaded",
               "can't use the admin app", "something went wrong")
START_TEXTS = ("get started", "start", "let's go", "begin")
# Tapped in this order once the QR code is scanned. "Install anyway" first: the probe also wants
# to know whether a warning can be passed. Matched against whole button labels only, so Cancel,
# Stop setup, Emergency call and the like are never pressed.
POSITIVE = ("install anyway", "accept & continue", "accept and continue", "accept", "agree", "i agree",
            "continue", "next", "ok", "got it", "allow", "set as default", "skip", "not now", "done")


# ---- release -------------------------------------------------------------------------------

def pick_release(releases: list[dict], tag: str | None = None) -> tuple[dict, dict, dict]:
    """Newest non-draft release (pre-releases count: all are pre-releases today) with
    plainphone-X.apk and plainphone-X.apk.json. Returns (release, apk asset, json asset)."""
    for release in releases:
        if release.get("draft") or (tag and release.get("tag_name") != tag):
            continue
        version = release.get("tag_name", "").removeprefix("v")
        assets = {a["name"]: a for a in release.get("assets", [])}
        apk, meta = assets.get(f"plainphone-{version}.apk"), assets.get(f"plainphone-{version}.apk.json")
        if apk and meta:
            return release, apk, meta
    raise SystemExit(f"no release{' ' + tag if tag else ''} with plainphone-VERSION.apk and .apk.json")


def check_apk(apk: Path, metadata: dict, tag: str) -> str:
    """SHA-256 of the APK, after checking it and the version against the .apk.json asset."""
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    if not re.fullmatch(r"[0-9a-f]{64}", str(metadata.get("sha256", ""))):
        raise SystemExit(f"{apk.name}.json has no sha256")
    if digest != metadata["sha256"]:
        raise SystemExit(f"SHA-256 mismatch: {apk.name} is {digest}, .apk.json says {metadata['sha256']}")
    if metadata.get("versionName") != tag.removeprefix("v"):
        raise SystemExit(f".apk.json versionName {metadata.get('versionName')!r} does not match {tag}")
    return digest


def fetch(out: Path, tag: str | None) -> None:
    headers = {"Accept": "application/vnd.github+json"}
    if os.environ.get("GH_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['GH_TOKEN']}"

    def get(url: str, auth: bool = True) -> bytes:
        # Asset downloads redirect to storage that rejects a second credential: no token there.
        request = urllib.request.Request(url, headers=headers if auth else {})
        with urllib.request.urlopen(request, timeout=120) as r:
            return r.read()

    api = f"https://api.github.com/repos/{REPO}/releases"
    releases = [json.loads(get(f"{api}/tags/{tag}"))] if tag else json.loads(get(f"{api}?per_page=30"))
    release, apk_asset, meta_asset = pick_release(releases, tag)
    out.mkdir(parents=True, exist_ok=True)
    apk = out / apk_asset["name"]
    apk.write_bytes(get(apk_asset["browser_download_url"], auth=False))
    metadata = json.loads(get(meta_asset["browser_download_url"], auth=False))
    digest = check_apk(apk, metadata, release["tag_name"])
    info = {"tag": release["tag_name"], "apk": str(apk), "apk_url": apk_asset["browser_download_url"],
            "sha256": digest, "versionCode": metadata.get("versionCode")}
    (out / "release.json").write_text(json.dumps(info, indent=2) + "\n")
    print(f"{release['tag_name']}: {apk.name} sha256 {digest} matches {meta_asset['name']}")


# ---- QR camera frame -----------------------------------------------------------------------

def qr_modules(ascii_qr: str) -> list[list[bool]]:
    """Parses `qrencode -t ASCII` (two characters per module, '#' is dark)."""
    rows = [line for line in ascii_qr.splitlines() if line.strip("\n")]
    width = max(len(r) for r in rows)
    return [[(row.ljust(width)[i] == "#") for i in range(0, width, 2)] for row in rows]


def png_bytes(pixels: list[bytearray], width: int, height: int) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    raw = b"".join(b"\x00" + bytes(row) for row in pixels)
    header = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)  # 8-bit greyscale
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def camera_frame(modules: list[list[bool]], width: int = 1920, height: int = 1440) -> bytes:
    """The QR code centred on a white 4:3 frame (a camera's shape), so it is not stretched.
    It fills 80 % of the height, like a phone held over a screen."""
    n = len(modules)
    scale = max(1, int(height * 0.8) // n)
    left, top = (width - n * scale) // 2, (height - n * scale) // 2
    rows = []
    for y in range(height):
        row = bytearray(b"\xff" * width)
        my = (y - top) // scale
        if 0 <= y - top < n * scale:
            for mx, dark in enumerate(modules[my]):
                if dark:
                    row[left + mx * scale:left + (mx + 1) * scale] = b"\x00" * scale
        rows.append(row)
    return png_bytes(rows, width, height)


# ---- screens -------------------------------------------------------------------------------

def parse_ui(xml: str) -> list[dict]:
    """Visible nodes of a `uiautomator dump` with their label, clickability and centre."""
    start = xml.find("<?xml")
    if start < 0:
        start = xml.find("<hierarchy")
    end = xml.rfind("</hierarchy>")
    if start < 0 or end < 0:
        return []
    nodes = []
    for node in ET.fromstring(xml[start:end + len("</hierarchy>")]).iter("node"):
        m = re.fullmatch(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]", node.get("bounds", ""))
        if not m:
            continue
        x1, y1, x2, y2 = map(int, m.groups())
        label = (node.get("text") or node.get("content-desc") or "").strip()
        nodes.append({"label": label, "clickable": node.get("clickable") == "true",
                      "enabled": node.get("enabled") != "false", "package": node.get("package", ""),
                      "bounds": (x1, y1, x2, y2), "center": ((x1 + x2) // 2, (y1 + y2) // 2)})
    return nodes


def screen_texts(nodes: list[dict]) -> list[str]:
    return [n["label"] for n in nodes if n["label"]]


def signature(nodes: list[dict]) -> str:
    return hashlib.sha1("\n".join(sorted(set(screen_texts(nodes)))).encode()).hexdigest()[:10]


def classify(texts: list[str]) -> str | None:
    """'block', 'warning' (Play Protect, can be passed or is a question) or 'error' (setup failed)."""
    joined = "\n".join(texts).lower().replace("’", "'")
    # The sideload dialog is titled "Blocked by Play Protect" yet offers Install anyway: passable.
    if "install anyway" in joined:
        return "warning"
    if any(t in joined for t in BLOCK_TEXTS) or (
            "blocked" in joined and ("play protect" in joined or "unsafe app" in joined)):
        return "block"
    if any(t in joined for t in WARNING_TEXTS):
        return "warning"
    if any(t in joined for t in ERROR_TEXTS):
        return "error"
    return None


def norm(label: str) -> str:
    return re.sub(r"\s+", " ", label.lower().replace("’", "'")).strip()


def choose_tap(nodes: list[dict]) -> dict | None:
    """The button a parent would press to go on, or None. Button labels only, never body text."""
    buttons = [n for n in nodes if n["label"] and n["enabled"] and len(n["label"]) <= 40]
    labels = {norm(n["label"]): n for n in reversed(buttons)}
    # The network step lists the emulator's Wi-Fi next to Skip; picking it is what a parent does.
    if "androidwifi" in labels and not any(norm(n["label"]) == "connected" for n in nodes):
        return labels["androidwifi"]
    for word in POSITIVE:
        if word in labels:
            return labels[word]
    # Play Protect's "Send app for a security check?" has only Send / Don't send. Not sending
    # changes nothing about the install, so take it.
    if "don't send" in labels:
        return labels["don't send"]
    return None


def empty_spots(nodes: list[dict], width: int, height: int) -> list[tuple[int, int]]:
    """Points on the welcome screen outside every clickable element, for the six taps."""
    clickable = [n["bounds"] for n in nodes if n["clickable"]]
    spots = []
    for fx, fy in ((0.5, 0.35), (0.5, 0.5), (0.5, 0.22), (0.3, 0.45), (0.7, 0.6)):
        x, y = int(width * fx), int(height * fy)
        if not any(x1 <= x <= x2 and y1 <= y <= y2 for x1, y1, x2, y2 in clickable):
            spots.append((x, y))
    return spots


def owners_include_plainphone(dpm_output: str) -> bool:
    # `dpm list-owners` prints "User  0: admin=org.plainphone.app/.PlainphoneAdminReceiver,DeviceOwner".
    return any(PACKAGE in line and "deviceowner" in line.replace(" ", "").lower() for line in dpm_output.splitlines())


def setup_apps(packages: str) -> dict:
    """Which setup app the image has, from `pm list packages -u`. None when nothing was listed."""
    names = {line.removeprefix("package:").strip() for line in packages.splitlines() if line.startswith("package:")}
    if not names:
        return {"google_setup_wizard": None, "setup_packages": []}
    return {"google_setup_wizard": GOOGLE_SETUP_WIZARD in names,
            "setup_packages": sorted(n for n in names if "setup" in n.lower() or n.endswith(".provision"))}


def no_qr_path(obs: dict) -> str | None:
    """Why this boot cannot reach the wizard's QR reader, or None if it can try."""
    wizard = obs["setup_wizard"]
    if wizard["google_setup_wizard"] is None:
        return "could not list the image's packages, so it is unknown whether it has a setup wizard"
    if not wizard["google_setup_wizard"]:
        return (f"the image has no Google setup wizard ({GOOGLE_SETUP_WIZARD} is not installed; setup apps: "
                f"{', '.join(wizard['setup_packages']) or 'none'}). The six-tap QR reader is part of that wizard, "
                "so this image has no QR path; SDK emulator images mark the device provisioned at first boot "
                "instead. Test on a real phone (docs/testing.md)")
    if obs["user_setup_complete"] == "1":
        # DevicePolicyManagerService caches "setup complete" and only ever sets it, so putting the
        # setting back to 0 would not make ManagedProvisioning accept a Device Owner again.
        return ("the image skipped the setup wizard (user_setup_complete=1), so there is no QR path; Android's "
                "device policy service has recorded setup as complete, which resetting the setting does not undo")
    if owners_include_plainphone(obs["owners_before"]):
        return "Plainphone was Device Owner before the scan"
    return None


def conclude(obs: dict) -> dict:
    """Turns what the run saw into the answer. Only CONCLUSIVE values pass the job."""
    pp = obs.get("play_protect")
    owner = obs.get("device_owner")  # True (dpm), "inferred" (adb cut by the lock) or False
    if obs.get("inconclusive"):
        return {"conclusion": "inconclusive", "reason": obs["inconclusive"]}
    if owner:
        if pp == "block":
            return {"conclusion": "inconclusive",
                    "reason": "a Play Protect block screen was seen, yet Plainphone became Device Owner"}
        return {"conclusion": "provisioned_after_warning" if pp == "warning" else "provisioned",
                "reason": "Plainphone is Device Owner" + (
                    " (dpm list-owners)" if owner is True else
                    " (inferred: adb was turned off right after Plainphone was installed, which only "
                    "the Device Owner lock does; dpm could not be read first)")}
    if pp == "block":
        return {"conclusion": "blocked_by_play_protect", "reason": "Play Protect blocked the app during setup"}
    if obs.get("error_screen"):
        return {"conclusion": "inconclusive",
                "reason": f"setup failed without a Play Protect screen: {obs['error_screen']!r}; read logcat"}
    return {"conclusion": "inconclusive", "reason": obs.get("stopped") or "provisioning did not finish in time"}


# ---- device --------------------------------------------------------------------------------

class Device:
    def __init__(self, out: Path):
        self.out = out
        self.screens = out / "screens"
        self.screens.mkdir(parents=True, exist_ok=True)
        self.adb_alive = True
        self.shot = 0

    def adb(self, *args: str, timeout: int = 30, binary: bool = False):
        try:
            r = subprocess.run(("adb", *args), capture_output=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            return None
        if r.returncode != 0:
            return None
        return r.stdout if binary else r.stdout.decode(errors="replace")

    def shell(self, command: str, timeout: int = 30) -> str | None:
        return self.adb("shell", command, timeout=timeout)

    def state(self) -> str:
        """Raw `adb get-state`: "device", "offline", ... or "unreachable"."""
        state = self.adb("get-state", timeout=10)
        return state.strip() if state is not None else "unreachable"

    def online(self) -> bool:
        return self.state() == "device"

    def ui(self) -> list[dict]:
        for _ in range(3):
            xml = self.shell("uiautomator dump /data/local/tmp/ui.xml >/dev/null 2>&1; cat /data/local/tmp/ui.xml", 40)
            if xml and "<hierarchy" in xml:
                self.last_xml = xml
                return parse_ui(xml)
            time.sleep(2)
        self.last_xml = ""
        return []

    def screenshot(self, name: str) -> str | None:
        self.shot += 1
        path = self.screens / f"{self.shot:02d}-{re.sub(r'[^a-z0-9]+', '-', name.lower())[:40].strip('-')}.png"
        png = self.adb("exec-out", "screencap", "-p", binary=True, timeout=30)
        if png and png.startswith(b"\x89PNG"):
            path.write_bytes(png)
            return path.name
        # adb is off (the lock turns it off): the emulator console still answers.
        tmp = self.out / "console-shot"
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir()
        self.adb("emu", "screenrecord", "screenshot", str(tmp), timeout=30)
        found = sorted(tmp.glob("*.png"))
        if found:
            found[-1].rename(path)
            return path.name
        return None

    def tap(self, x: int, y: int) -> None:
        self.shell(f"input tap {x} {y}")


def adb_stays_off(dev, seconds: float = 30, step: float = 5) -> tuple[bool, list[str]]:
    """True only if adb stays away for `seconds`, checked several times. A busy emulator (dex2oat
    right after the install) can drop adb for a moment; only the Device Owner lock keeps it off."""
    states = [dev.state()]
    end = time.time() + seconds
    while states[-1] != "device" and time.time() < end:
        time.sleep(step)
        states.append(dev.state())
    return states[-1] != "device" and len(states) >= 3, states


def wait_for(predicate, deadline: float, step: float = 3):
    while time.time() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(step)
    return None


def run(args: argparse.Namespace) -> int:
    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    release = json.loads(args.release.read_text())
    obs: dict = {"timeline": [], "play_protect": None, "play_protect_texts": [], "bypassed_warning": False,
                 "device_owner": False, "error_screen": None}
    started = time.time()

    def log(event: str, **data) -> None:
        entry = {"t": round(time.time() - started, 1), "event": event, **data}
        obs["timeline"].append(entry)
        print(json.dumps(entry), flush=True)

    # A fixed console port and serial: `adb emu` reaches the console by the serial's port number,
    # which is how the probe still takes screenshots after the lock has turned adb off.
    os.environ["ANDROID_SERIAL"] = "emulator-5554"
    emulator_log = (out / "emulator.log").open("w")
    emulator = subprocess.Popen(
        [str(Path(os.environ["ANDROID_HOME"], "emulator", "emulator")), "-avd", args.avd, "-port", "5554", "-wipe-data",
         "-no-snapshot", "-no-window", "-gpu", "swiftshader_indirect", "-noaudio", "-no-boot-anim",
         "-camera-back", f"imagefile:{args.qr.resolve()}", "-camera-front", "none"],
        stdout=emulator_log, stderr=subprocess.STDOUT)
    dev = Device(out)
    logcat_proc = None
    poller_stop = threading.Event()
    try:
        if not wait_for(lambda: (dev.shell("getprop sys.boot_completed", 10) or "").strip() == "1",
                        time.time() + args.boot_timeout, 5):
            obs["inconclusive"] = "the emulator did not finish booting"
            return finish(out, obs, release, dev, args)
        log("booted")
        logcat_proc = subprocess.Popen(["adb", "logcat", "-v", "threadtime", "-b", "all"],
                                       stdout=(out / "logcat.txt").open("wb"), stderr=subprocess.DEVNULL)
        for key, cmd in {"fingerprint": "getprop ro.build.fingerprint", "sdk": "getprop ro.build.version.sdk",
                         "user_setup_complete": "settings get secure user_setup_complete",
                         "device_provisioned": "settings get global device_provisioned",
                         "owners_before": "dpm list-owners",
                         "play_store": "dumpsys package com.android.vending | grep -m1 versionName",
                         "play_services": "dumpsys package com.google.android.gms | grep -m1 versionName",
                         "screen": "wm size"}.items():
            obs[key] = (dev.shell(cmd) or "").strip()
        obs["setup_wizard"] = setup_apps(dev.shell("pm list packages -u") or "")
        log("device", setup_wizard=obs["setup_wizard"],
            **{k: obs[k] for k in ("fingerprint", "sdk", "user_setup_complete", "device_provisioned", "play_store")})
        if reason := no_qr_path(obs):
            obs["inconclusive"] = reason
            return finish(out, obs, release, dev, args)
        m = re.search(r"(\d+)x(\d+)", obs["screen"])
        width, height = (int(m[1]), int(m[2])) if m else (1080, 2400)

        # Device Owner is set before Plainphone's own setup step, which turns adb off within seconds.
        # Poll in the background so that moment is not missed between screens.
        installed = threading.Event()

        def poll_owner():
            while not poller_stop.is_set():
                owners = dev.adb("shell", "dpm list-owners", timeout=10)
                if owners is not None:
                    if owners_include_plainphone(owners) and obs["device_owner"] is not True:
                        obs["device_owner"] = True
                        log("device_owner", owners=owners.strip())
                    if not installed.is_set() and "package:" in (dev.adb("shell", f"pm path {PACKAGE}", timeout=10) or ""):
                        installed.set()
                        log("plainphone_installed")
                poller_stop.wait(1)
        poller = threading.Thread(target=poll_owner, daemon=True)
        poller.start()

        # Welcome screen: wait for its start button, then six taps on an empty spot.
        def welcome():
            nodes = dev.ui()
            return nodes if any(norm(n["label"]) in START_TEXTS for n in nodes) else None
        nodes = wait_for(welcome, time.time() + args.wizard_timeout, 5)
        if not nodes:
            dev.screenshot("no-welcome")
            obs["inconclusive"] = "the setup wizard's welcome screen did not appear"
            return finish(out, obs, release, dev, args)
        welcome_sig = signature(nodes)
        log("welcome", screenshot=dev.screenshot("welcome"), texts=screen_texts(nodes))
        opened = False
        for x, y in empty_spots(nodes, width, height):
            # One shell command, so the six taps are not slowed down by six adb round trips.
            dev.shell("; ".join([f"input tap {x} {y}"] * 6))
            log("six_taps", x=x, y=y)
            after = wait_for(lambda: (lambda n: n if n and signature(n) != welcome_sig else None)(dev.ui()),
                             time.time() + 20, 3)
            if after:
                opened = True
                break
        if not opened:
            dev.screenshot("six-taps-did-nothing")
            obs["inconclusive"] = "six taps on the welcome screen did not open the QR setup"
            return finish(out, obs, release, dev, args)

        # From here: record every new screen and press the button a parent would press.
        deadline = time.time() + args.flow_timeout
        seen: set[str] = set()
        last_change = time.time()
        blocked_at = None
        unreadable_shot = 0.0
        after_owner_until = None
        while time.time() < deadline:
            if not dev.online():
                if dev.adb("emu", "avd", "name", timeout=20) is None:
                    obs["stopped"] = "the emulator stopped answering"
                    log("emulator_gone")
                    break
                if installed.is_set() or obs["device_owner"]:
                    off, states = adb_stays_off(dev)
                    log("adb_state", states=states)
                    if not off:
                        continue  # adb came back: a hiccup, not the lock
                    if not obs["device_owner"]:
                        obs["device_owner"] = "inferred"
                    log("adb_off", note="the Device Owner lock turned adb off")
                else:
                    obs["stopped"] = "adb went away before Plainphone was installed"
                    log("adb_lost")
                for i in range(6):  # what the screen shows afterwards, through the emulator console
                    time.sleep(10)
                    dev.screenshot(f"after-adb-off-{i}")
                break
            nodes = dev.ui()
            sig = signature(nodes)
            texts = screen_texts(nodes)
            if nodes and sig not in seen:
                seen.add(sig)
                last_change = time.time()
                kind = classify(texts)
                log("screen", screenshot=dev.screenshot("-".join(texts[:3]) or "screen"), texts=texts, kind=kind)
                (dev.screens / f"{dev.shot:02d}.xml").write_text(dev.last_xml)
                if kind in ("block", "warning"):
                    if obs["play_protect"] != "block":
                        obs["play_protect"] = kind
                    if kind == "block" and blocked_at is None:
                        blocked_at = time.time()
                    obs["play_protect_texts"].append(texts)
                elif kind == "error" and not obs["device_owner"]:
                    obs["error_screen"] = " / ".join(texts[:4])
            elif not nodes and time.time() - unreadable_shot > 30:
                # uiautomator cannot read a screen that never idles (a camera preview): still record it.
                unreadable_shot = time.time()
                log("unreadable_screen", screenshot=dev.screenshot("no-ui-dump"))
            if obs["device_owner"] and after_owner_until is None:
                after_owner_until = time.time() + 90  # Plainphone's own setup screens
            if after_owner_until and time.time() > after_owner_until:
                break
            if blocked_at and time.time() - blocked_at > 20 and not obs["device_owner"]:
                break  # give the block 20 s to turn into its final screen
            if obs["error_screen"] and time.time() - last_change > 20:
                break
            target = choose_tap(nodes)
            if target:
                if norm(target["label"]) == "install anyway":
                    obs["bypassed_warning"] = True
                log("tap", label=target["label"])
                dev.tap(*target["center"])
                time.sleep(3)
            elif time.time() - last_change > args.stuck_timeout:
                dev.screenshot("stuck")
                obs["stopped"] = f"stuck for {args.stuck_timeout}s on: {' / '.join(texts[:4]) or 'an empty screen'}"
                break
            else:
                time.sleep(3)
        else:
            obs["stopped"] = f"no conclusion within {args.flow_timeout}s"
        return finish(out, obs, release, dev, args)
    finally:
        poller_stop.set()
        if logcat_proc:
            logcat_proc.terminate()
        subprocess.run(["adb", "emu", "kill"], capture_output=True, timeout=30, check=False)
        try:
            emulator.wait(timeout=30)
        except subprocess.TimeoutExpired:
            emulator.kill()
        emulator_log.close()


HIGHLIGHT = re.compile(r"Finsky|PlayProtect|Play Protect|PackageVerif|[Vv]erif(y|ication).*" + re.escape(PACKAGE)
                       + r"|ManagedProvisioning|ProvisionLogger|DevicePolicyManager.*[Oo]wner|" + re.escape(PACKAGE))


def finish(out: Path, obs: dict, release: dict, dev: Device, args: argparse.Namespace) -> int:
    if dev.online():
        owners = dev.shell("dpm list-owners") or ""
        if owners_include_plainphone(owners):
            obs["device_owner"] = True
        obs["owners_after"] = owners.strip()
        obs["user_setup_complete_after"] = (dev.shell("settings get secure user_setup_complete") or "").strip()
        (out / "device_policy.txt").write_text(dev.shell("dumpsys device_policy", 60) or "")
        dev.screenshot("final")
    logcat = out / "logcat.txt"
    lines = logcat.read_text(errors="replace").splitlines() if logcat.exists() else []
    highlights = [line for line in lines if HIGHLIGHT.search(line)]
    (out / "logcat-highlights.txt").write_text("\n".join(highlights) + "\n")
    verdict = conclude(obs)
    finished = True if obs["device_owner"] else (False if obs["play_protect"] == "block" or obs["error_screen"] else None)
    result = {
        **verdict,
        "release": {k: release.get(k) for k in ("tag", "sha256", "apk_url", "versionCode")},
        "image": args.image,
        "device": {k: obs.get(k) for k in ("fingerprint", "sdk", "play_store", "play_services",
                                             "user_setup_complete", "device_provisioned")},
        "setup_wizard": obs.get("setup_wizard"),
        "play_protect": {"shown": obs["play_protect"] is not None, "kind": obs["play_protect"],
                         "bypassed_warning": obs["bypassed_warning"], "texts": obs["play_protect_texts"]},
        "provisioning_finished": finished,
        "device_owner": obs["device_owner"],
        "owners_after": obs.get("owners_after"),
        "user_setup_complete_after": obs.get("user_setup_complete_after"),
        "error_screen": obs["error_screen"],
        "logcat_highlight_lines": len(highlights),
        "screens": sorted(p.name for p in dev.screens.glob("*.png")),
        "timeline": obs["timeline"],
        "matches_real_qr_path": "see docs/testing.md#dpc-provisioning-probe",
    }
    (out / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    summary = (f"## DPC provisioning probe: {verdict['conclusion']}\n\n{verdict['reason']}\n\n"
               f"- Release: {release.get('tag')} (sha256 `{release.get('sha256')}`)\n- Image: {args.image}\n"
               f"- Google setup wizard: {(obs.get('setup_wizard') or {}).get('google_setup_wizard')}\n"
               f"- Play Protect: {result['play_protect']['kind'] or 'no screen'}"
               f"{' (passed with Install anyway)' if obs['bypassed_warning'] else ''}\n"
               f"- Device Owner: {obs['device_owner']}\n- Screens: {len(result['screens'])}\n")
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
            f.write(summary)
    if verdict["conclusion"] not in CONCLUSIVE:
        print(f"::error::No conclusion: {verdict['reason']}")
        return 1
    if verdict["conclusion"] == "blocked_by_play_protect":
        print("::warning::Play Protect blocked Plainphone's QR setup on this image")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="command", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("--out", type=Path, required=True)
    f.add_argument("--tag", help="release tag, e.g. v0.1.20 (default: the newest release)")
    c = sub.add_parser("canvas")
    c.add_argument("ascii", type=Path)
    c.add_argument("png", type=Path)
    r = sub.add_parser("run")
    r.add_argument("--avd", required=True)
    r.add_argument("--image", required=True, help="system image package, for the report")
    r.add_argument("--qr", type=Path, required=True)
    r.add_argument("--release", type=Path, required=True)
    r.add_argument("--out", type=Path, required=True)
    r.add_argument("--boot-timeout", type=int, default=480)
    r.add_argument("--wizard-timeout", type=int, default=240)
    r.add_argument("--flow-timeout", type=int, default=900)
    r.add_argument("--stuck-timeout", type=int, default=150)
    args = p.parse_args()
    if args.command == "fetch":
        fetch(args.out, args.tag or None)
        return 0
    if args.command == "canvas":
        args.png.write_bytes(camera_frame(qr_modules(args.ascii.read_text())))
        return 0
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
