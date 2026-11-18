#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Plainphone authors
"""Build the QR code that turns a factory-reset Android phone into a Plainphone.

The phone shows a QR reader after six taps on the welcome screen. It downloads
the APK from --apk-url, checks the signing certificate against the checksum
read from --apk, and makes Plainphone the Device Owner.

Most parents do not need this script: "Add phone" in the dashboard shows the same QR code,
with the PIN hashed in the browser and a one-time token that pairs the phone by itself.
The script is for self-hosters, tests and phones without an account.

Examples:
  # The stable download address always serves the newest release (signed with the same key)
  scripts/provisioning-qr.py --checksum iGj8FnevSjpvbT6FjOJt-bbsEQc1nbs8I4MbDOBUEhU --ask-pin --out dist/qr

  # Your own build
  scripts/provisioning-qr.py --apk app-release.apk --apk-url https://example.org/plainphone.apk --ask-pin

  # Wi-Fi in the QR code (keep that PNG private: it contains the password)
  scripts/provisioning-qr.py ... --wifi-ssid Home --wifi-password secret

  # Plainphone's own filter DNS with a ClientID per phone, plus approved contacts
  scripts/provisioning-qr.py ... --dns-host '{id}.dns.plainphone.org' \
      --country-code 45 --contact 'Mum=+45 12 34 56 78' --contact 'Dad=87654321'

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
import urllib.parse
from pathlib import Path

PACKAGE = "org.plainphone.app"
ADMIN_COMPONENT = f"{PACKAGE}/.PlainphoneAdminReceiver"
PBKDF2_ITERATIONS = 120_000  # must match MaintenancePin.kt
PREFIX = "android.app.extra."

# Forced private DNS. Until dns.plainphone.org serves, the default is AdGuard's
# public family resolver. The template gives every phone its own ClientID, which
# selects the phone's filter profile on the Plainphone DNS server (see dns/).
DEFAULT_DNS_HOST = "family.adguard-dns.com"
PLAINPHONE_DNS_TEMPLATE = "{id}.dns.plainphone.org"
# Same rules as the DNS server's ClientIDs (dns/ppdns/profiles.py).
CLIENT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{3,62}$")
CLIENT_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"
HOST_RE = re.compile(r"^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$")  # as PolicyConfig.kt
CONTACT_RE = re.compile(r"^\+?[0-9 ()./-]{3,24}$")
# Where the phone pairs and fetches its rules (phase 4). Self-hosters pass their own.
DEFAULT_SERVER_URL = "https://app.plainphone.org"
# Redirects to the newest released APK (server/src/routes/download.ts), so QR codes do not go stale.
DEFAULT_APK_URL = "https://app.plainphone.org/download/android"


def new_client_id(length: int = 20) -> str:
    """Random, unguessable ClientID (about 103 bits), like the DNS server makes."""
    return "".join(secrets.choice(CLIENT_ID_ALPHABET) for _ in range(length))


def resolve_dns_host(template: str, client_id: str | None) -> tuple[str, str | None]:
    """Fills in {id}. Returns the host and the ClientID used (None if the host has no {id})."""
    if "{id}" not in template:
        if client_id:
            raise ValueError("--dns-id needs a --dns-host with {id} in it")
        host, used = template, None
    else:
        used = client_id or new_client_id()
        if not CLIENT_ID_RE.match(used):
            raise ValueError("--dns-id must be 4-63 characters a-z, 0-9 and '-', starting with a letter or digit")
        host = template.replace("{id}", used)
    if not HOST_RE.match(host):
        raise ValueError(f"not a valid DNS host: {host}")
    return host, used


def check_server_url(url: str) -> str:
    """HTTPS only, no credentials, query or fragment (same rules as PolicyConfig.normalizeServerUrl)."""
    parsed = urllib.parse.urlsplit(url.strip())
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("--server-url must be https://host[:port][/path] without credentials or query")
    return url.strip().rstrip("/")


def contacts_extra(contacts: list[str]) -> str:
    """'Name=number' entries joined the way the app reads them (ContactCodec.kt)."""
    out = []
    for raw in contacts:
        name, sep, number = raw.rpartition("=")
        number = number.strip()
        if not sep or not CONTACT_RE.match(number):
            raise ValueError(f"--contact must be NAME=NUMBER, got {raw!r}")
        name = re.sub(r" +", " ", re.sub(r"[;=\n\r\t]", " ", name)).strip() or number
        out.append(f"{name}={number}")
    return ";".join(out)


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
        "plainphone.dns_host": args.dns_host,  # already resolved from the {id} template
        "plainphone.pin_hash": pin_hash(pin, salt),
        "plainphone.pin_salt": salt,
        "plainphone.relock_minutes": str(args.relock_minutes),
        "plainphone.server_url": getattr(args, "server_url", None) or DEFAULT_SERVER_URL,
    }
    if args.allow:
        extras["plainphone.allowed_packages"] = ",".join(args.allow)
    if args.frp_account:
        extras["plainphone.frp_account_ids"] = ",".join(args.frp_account)
    if getattr(args, "country_code", None):
        extras["plainphone.country_code"] = args.country_code.lstrip("+")
    if getattr(args, "contact", None):
        extras["plainphone.contacts"] = contacts_extra(args.contact)
    if getattr(args, "enroll_token", None):
        extras["plainphone.enroll"] = args.enroll_token

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
    p.add_argument("--apk-url", default=DEFAULT_APK_URL,
                   help=f"HTTPS URL the phone downloads the APK from (default: {DEFAULT_APK_URL})")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--apk", type=Path, help="local copy of the same APK, to read the signing checksum")
    src.add_argument("--checksum", help="signature checksum, if you already have it")
    p.add_argument("--pin", help="maintenance PIN, 6+ digits (ends up in shell history; prefer --ask-pin)")
    p.add_argument("--ask-pin", action="store_true", help="prompt for the PIN without echo")
    p.add_argument("--dns-host", default=DEFAULT_DNS_HOST,
                   help=f"forced private DNS host; {{id}} is replaced by the phone's ClientID, "
                        f"e.g. '{PLAINPHONE_DNS_TEMPLATE}' (default: {DEFAULT_DNS_HOST})")
    p.add_argument("--dns-id", help="ClientID for {id} in --dns-host (default: a new random one)")
    p.add_argument("--country-code", help="calling code of the phone's country, e.g. 45; default: read from the SIM")
    p.add_argument("--contact", action="append", default=[], metavar="NAME=NUMBER",
                   help="approved contact (repeatable); more can be added on the phone's maintenance screen")
    p.add_argument("--allow", action="append", default=[], metavar="PACKAGE", help="extra visible app (repeatable)")
    p.add_argument("--frp-account", action="append", default=[], metavar="ID",
                   help="Google account ID (numeric People API id, not an email) allowed after a recovery reset")
    p.add_argument("--relock-minutes", type=int, default=30)
    p.add_argument("--server-url", default=DEFAULT_SERVER_URL,
                   help=f"server the phone pairs with and fetches rules from (default: {DEFAULT_SERVER_URL})")
    p.add_argument("--enroll-token", help="one-time token from POST /phones/enroll; the phone then pairs by itself")
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

    if args.enroll_token and not re.fullmatch(r"pp_e_[A-Za-z0-9_-]{10,95}", args.enroll_token):
        sys.exit("--enroll-token must look like pp_e_...")
    if args.country_code and not re.fullmatch(r"\+?[0-9]{1,3}", args.country_code):
        sys.exit("--country-code must be 1-3 digits, e.g. 45")
    try:
        args.dns_host, dns_id = resolve_dns_host(args.dns_host, args.dns_id)
        args.server_url = check_server_url(args.server_url)
        contacts_extra(args.contact)
        if not args.country_code and any(not c.rpartition("=")[2].strip().startswith("+") for c in args.contact):
            raise ValueError("a --contact without +country code needs --country-code (e.g. 45)")
    except ValueError as e:
        sys.exit(str(e))

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
    print(f"private DNS host: {args.dns_host}")
    print(f"server: {args.server_url}")
    if args.enroll_token:
        print("  After setup the phone pairs itself with the enrollment token.")
    else:
        print("  After setup the phone shows a pairing code; claim it in the dashboard (Add phone, Type the code).")
    print("  The server then registers the phone's own DNS ClientID and the phone switches to it.")
    if dns_id:
        print(f"DNS ClientID: {dns_id}")
        print("  It must be registered on the DNS server BEFORE scanning, or the phone gets no DNS at all")
        print("  (unknown IDs are refused). Easiest: run `docker compose exec api python -m ppdns create child`")
        print("  on the DNS server and pass the printed client_id as --dns-id. Or register this ID with")
        print('  POST /v1/clients {"client_id": "...", "profile": "child"}. See dns/README.md.')
    print(f"QR JSON:  {json_path}")
    if png_path:
        print(f"QR image: {png_path}")
    if args.wifi_password:
        print("NOTE: the QR code contains the Wi-Fi password. Do not publish it.")
    if not args.pin:
        print(f"maintenance PIN (shown once, store it safely): {pin}")


if __name__ == "__main__":
    main()
