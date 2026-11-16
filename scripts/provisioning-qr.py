#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Plainphone authors
"""Build the QR code that turns a factory-reset Android phone into a Plainphone.

The phone shows a QR reader after six taps on the welcome screen. It downloads
the APK from --apk-url, checks the signing certificate against the checksum
read from --apk, and makes Plainphone the Device Owner.

Examples:
  scripts/provisioning-qr.py --apk app-release.apk \
      --apk-url https://github.com/plainphone/plainphone/releases/download/v0.1.0-phase1/plainphone-0.1.0-phase1.apk \
      --ask-pin --out dist/qr

  # Wi-Fi in the QR code (keep that PNG private: it contains the password)
  scripts/provisioning-qr.py ... --wifi-ssid Home --wifi-password secret

Needs Python 3.9+, `apksigner` (Android build-tools; found via ANDROID_HOME)
and `qrencode` for the PNG (apt install qrencode). Use --checksum to skip apksigner.
"""
from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
from pathlib import Path

PACKAGE = "org.plainphone.app"
ADMIN_COMPONENT = f"{PACKAGE}/.PlainphoneAdminReceiver"
PBKDF2_ITERATIONS = 120_000  # must match MaintenancePin.kt
PREFIX = "android.app.extra."


def find_apksigner() -> str:
    found = shutil.which("apksigner")
    if found:
        return found
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if sdk:
        candidates = sorted(Path(sdk, "build-tools").glob("*/apksigner"))
        if candidates:
            return str(candidates[-1])
    sys.exit("apksigner not found: set ANDROID_HOME or pass --checksum")


def signature_checksum(apk: Path) -> str:
    """URL-safe base64 (no padding) of the SHA-256 of the APK's signing certificate."""
    out = subprocess.run(
        [find_apksigner(), "verify", "--print-certs", str(apk)],
        check=True, capture_output=True, text=True,
    ).stdout
    digests = set(re.findall(r"certificate SHA-256 digest: ([0-9a-f]{64})", out))
    if len(digests) != 1:
        sys.exit(f"expected exactly one signing certificate, found {len(digests)}")
    return base64.urlsafe_b64encode(bytes.fromhex(digests.pop())).decode().rstrip("=")


def pin_hash(pin: str, salt_hex: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt_hex), PBKDF2_ITERATIONS, 32).hex()


def build_payload(args: argparse.Namespace, checksum: str, pin: str) -> dict:
    salt = secrets.token_hex(16)
    extras = {
        "plainphone.dns_host": args.dns_host,
        "plainphone.pin_hash": pin_hash(pin, salt),
        "plainphone.pin_salt": salt,
        "plainphone.relock_minutes": str(args.relock_minutes),
    }
    if args.allow:
        extras["plainphone.allowed_packages"] = ",".join(args.allow)
    if args.frp_account:
        extras["plainphone.frp_account_ids"] = ",".join(args.frp_account)

    payload = {
        PREFIX + "PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME": ADMIN_COMPONENT,
        PREFIX + "PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION": args.apk_url,
        PREFIX + "PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM": checksum,
        # Keep the maker's dialer, messages, camera and clock installed; Plainphone hides the rest.
        PREFIX + "PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED": True,
        PREFIX + "PROVISIONING_ADMIN_EXTRAS_BUNDLE": extras,
    }
    if args.wifi_ssid:
        payload[PREFIX + "PROVISIONING_WIFI_SSID"] = args.wifi_ssid
        payload[PREFIX + "PROVISIONING_WIFI_SECURITY_TYPE"] = args.wifi_security
        if args.wifi_password:
            payload[PREFIX + "PROVISIONING_WIFI_PASSWORD"] = args.wifi_password
        if args.wifi_hidden:
            payload[PREFIX + "PROVISIONING_WIFI_HIDDEN"] = True
    return payload


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--apk-url", required=True, help="HTTPS URL the phone downloads the APK from")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--apk", type=Path, help="local copy of the same APK, to read the signing checksum")
    src.add_argument("--checksum", help="signature checksum, if you already have it")
    p.add_argument("--pin", help="maintenance PIN, 6+ digits (ends up in shell history; prefer --ask-pin)")
    p.add_argument("--ask-pin", action="store_true", help="prompt for the PIN without echo")
    p.add_argument("--dns-host", default="family.adguard-dns.com", help="forced private DNS host")
    p.add_argument("--allow", action="append", default=[], metavar="PACKAGE", help="extra visible app (repeatable)")
    p.add_argument("--frp-account", action="append", default=[], metavar="ID",
                   help="Google account ID (numeric People API id, not an email) allowed after a recovery reset")
    p.add_argument("--relock-minutes", type=int, default=30)
    p.add_argument("--wifi-ssid")
    p.add_argument("--wifi-password")
    p.add_argument("--wifi-security", default="WPA", choices=["NONE", "WEP", "WPA", "SAE"])
    p.add_argument("--wifi-hidden", action="store_true")
    p.add_argument("--out", type=Path, default=Path("dist/provisioning-qr"),
                   help="output path without extension; writes .json and .png")
    args = p.parse_args()

    if not args.apk_url.startswith("https://"):
        sys.exit("--apk-url must be HTTPS")
    if args.ask_pin:
        pin = getpass.getpass("Maintenance PIN (6+ digits): ")
        if getpass.getpass("Again: ") != pin:
            sys.exit("PINs do not match")
    else:
        pin = args.pin or f"{secrets.randbelow(10**6):06d}"
    if not pin.isdigit() or len(pin) < 6:
        sys.exit("the PIN must be at least 6 digits")

    checksum = args.checksum or signature_checksum(args.apk)
    payload = build_payload(args, checksum, pin)
    text = json.dumps(payload, separators=(",", ":"))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    json_path = args.out.with_suffix(".json")
    # The JSON holds a PIN hash (and maybe a Wi-Fi password): owner-only.
    json_path.touch(mode=0o600, exist_ok=True)
    json_path.chmod(0o600)
    json_path.write_text(json.dumps(payload, indent=2) + "\n")
    png_path = args.out.with_suffix(".png")
    if shutil.which("qrencode"):
        # Text via stdin, so the Wi-Fi password is not visible in the process list.
        subprocess.run(["qrencode", "-l", "L", "-s", "8", "-m", "4", "-o", str(png_path)], input=text.encode(), check=True)
        png_path.chmod(0o600)
    else:
        png_path = None
        print("qrencode not found: wrote JSON only (apt install qrencode)", file=sys.stderr)

    print(f"signature checksum: {checksum}")
    print(f"QR JSON:  {json_path}")
    if png_path:
        print(f"QR image: {png_path}")
    if args.wifi_password:
        print("NOTE: the QR code contains the Wi-Fi password. Do not publish it.")
    if not args.pin:
        print(f"maintenance PIN (shown once, store it safely): {pin}")


if __name__ == "__main__":
    main()
