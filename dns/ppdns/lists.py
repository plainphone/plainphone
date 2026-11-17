# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Plainphone authors
"""Blocklists and how they are turned into per-profile AdGuard filter files.

AdGuard Home applies filter lists to every client. To give the `child` profile
stricter lists than `self`, each profile-specific list is downloaded and every
rule gets a `$ctag=<tag>` modifier, so it only matches clients carrying that tag.
The rewritten files live under AdGuard's `safe_fs_patterns` directory and are
referenced by path in AdGuardHome.yaml.
"""

from __future__ import annotations

import dataclasses
import logging
import os
import tempfile
import time
import urllib.request

log = logging.getLogger("ppdns.lists")

# AdGuard Home has a fixed set of client tags (a client cannot have any other). Plainphone uses
# three of them as flags; the names mean nothing here. Which list each one switches on:
#
#   tag            switches on                                    set when
#   user_child     HaGeZi bypass (VPN/proxy/Tor), YouTube strict  profile is `child`, always
#   device_other   OISD NSFW (adult content)                      category `adult` is blocked
#   os_other       HaGeZi gambling                                category `gambling` is blocked
#
# Older ppdns versions tagged the gambling list `user_child`. build() retags such a file, and
# Service.upgrade_clients() adds `os_other` to the clients that had gambling blocked that way.
TAG_CHILD = "user_child"
TAG_ADULT = "device_other"
TAG_GAMBLING = "os_other"

# First line of every list we rewrite; it also says which tag the rules carry.
_HEADER = "! Rewritten by Plainphone ppdns: every rule applies only to clients tagged "

HAGEZI = "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock"


@dataclasses.dataclass(frozen=True)
class Source:
    key: str
    name: str
    url: str
    tag: str | None  # None: applies to every client (AdGuard downloads it itself)


SOURCES: tuple[Source, ...] = (
    # Every client: ads, tracking, malware, and encrypted-DNS endpoints that would bypass the filter.
    Source("hagezi-pro", "HaGeZi Multi PRO", f"{HAGEZI}/pro.txt", None),
    Source("oisd-big", "OISD big", "https://big.oisd.nl/", None),
    Source("hagezi-doh", "HaGeZi encrypted DNS (DoH/DoT/DoQ) bypass", f"{HAGEZI}/doh.txt", None),
    # Per category: applies to the phones that block that category.
    Source("oisd-nsfw", "OISD NSFW (adult content)", "https://nsfw.oisd.nl/", TAG_ADULT),
    Source("hagezi-gambling", "HaGeZi gambling (medium)", f"{HAGEZI}/gambling.medium.txt", TAG_GAMBLING),
    # Child profile only, and a parent cannot switch it off.
    Source(
        "hagezi-bypass",
        "HaGeZi DoH/VPN/TOR/proxy bypass",
        f"{HAGEZI}/doh-vpn-proxy-bypass.txt",
        TAG_CHILD,
    ),
)

# Lists written by ppdns itself (no download). AdGuard's SafeSearch maps YouTube to
# "moderate" Restricted Mode; children get the strict one. Hostnames from
# https://support.google.com/a/answer/6214622
YOUTUBE_HOSTS = (
    "www.youtube.com",
    "m.youtube.com",
    "youtubei.googleapis.com",
    "youtube.googleapis.com",
    "www.youtube-nocookie.com",
)
STATIC: dict[str, tuple[str, list[str]]] = {
    "plainphone-child-youtube-strict": (
        "Plainphone: YouTube strict Restricted Mode (child)",
        [f"|{host}^$dnsrewrite=NOERROR;CNAME;restrict.youtube.com,ctag={TAG_CHILD}" for host in YOUTUBE_HOSTS],
    ),
}

# Filter ids in AdGuardHome.yaml are stable so updates never duplicate lists.
FILTER_IDS = {source.key: index + 1 for index, source in enumerate(SOURCES)}
FILTER_IDS.update({key: len(SOURCES) + index + 1 for index, key in enumerate(STATIC)})


def wanted_filters(lists_dir: str) -> list[tuple[str, str, int]]:
    """(name, url, id) for every filter AdGuard should have, downloaded or local."""
    out = [(source.name, filter_url(lists_dir, source), FILTER_IDS[source.key]) for source in SOURCES]
    out += [(name, os.path.join(lists_dir, f"{key}.txt"), FILTER_IDS[key]) for key, (name, _) in STATIC.items()]
    return out


def write_static(lists_dir: str) -> None:
    os.makedirs(lists_dir, exist_ok=True)
    for key, (name, rules) in STATIC.items():
        target = os.path.join(lists_dir, f"{key}.txt")
        tmp = target + ".tmp"
        with open(tmp, "w", encoding="utf-8") as out:
            out.write(f"! {name}. Written by Plainphone ppdns.\n")
            out.writelines(rule + "\n" for rule in rules)
        os.chmod(tmp, 0o644)
        os.replace(tmp, target)


def local_path(lists_dir: str, source: Source) -> str:
    return os.path.join(lists_dir, f"{source.key}.txt")


def filter_url(lists_dir: str, source: Source) -> str:
    """What AdGuard should load: the upstream URL, or our tagged local copy."""
    return source.url if source.tag is None else local_path(lists_dir, source)


def tag_rules(lines, tag: str):
    """Yield the list with `$ctag=<tag>` added to every network rule.

    Comments and headers are dropped. Rules that already have modifiers get the
    tag appended (`,ctag=`); rules that already restrict clients are skipped,
    because combining two client restrictions would change their meaning.
    """
    yield f"{_HEADER}{tag}\n"
    for raw in lines:
        line = raw.strip()
        if not line or line[0] in "!#[":
            continue
        if line.startswith("/") and line.endswith("/"):
            continue  # regex rules without modifiers are rare and expensive; skip them
        if "$" in line:
            rule, _, modifiers = line.rpartition("$")
            if "ctag=" in modifiers or "client=" in modifiers:
                continue
            yield f"{rule}${modifiers},ctag={tag}\n"
        elif line.startswith(("||", "@@||")) or line.endswith("^"):
            yield f"{line}$ctag={tag}\n"
        else:
            # hosts-style ("0.0.0.0 example.com") or bare domain lines
            parts = line.split()
            domain = parts[-1]
            if domain in ("localhost", "0.0.0.0") or "." not in domain:
                continue
            yield f"||{domain}^$ctag={tag}\n"


def retag_file(path: str, tag: str) -> bool:
    """Point a list we wrote earlier at `tag`. Returns True if the file was changed.

    Used when a download fails and the old copy was written by a ppdns version that
    used another tag for this list. Files without our header are left alone.
    """
    with open(path, encoding="utf-8") as fh:
        first = fh.readline()
        if not first.startswith(_HEADER):
            return False
        old = first[len(_HEADER):].strip()
        if old == tag:
            return False
        suffix = f"ctag={old}\n"
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path) or ".", prefix=".retag.")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as out:
                out.write(f"{_HEADER}{tag}\n")
                out.writelines(
                    line[:-len(suffix)] + f"ctag={tag}\n" if line.endswith(suffix) else line
                    for line in fh
                )
            os.chmod(tmp, 0o644)
            # A retag is not a download. Keep the upstream copy's age.
            stat = os.fstat(fh.fileno())
            os.utime(tmp, ns=(stat.st_atime_ns, stat.st_mtime_ns))
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
    return True


def _download_age(path: str, tag: str) -> float | None:
    try:
        with open(path, encoding="utf-8") as fh:
            age = time.time() - os.fstat(fh.fileno()).st_mtime
            if age >= 0 and fh.readline() == f"{_HEADER}{tag}\n" and fh.readline():
                return age
    except (OSError, UnicodeError):
        pass
    return None


def refresh_delay(lists_dir: str, interval: float, retry_at: dict[str, float]) -> float:
    """Sleep until the next tagged download is due, including retry deadlines."""
    now = time.time()
    delay = interval
    for source in SOURCES:
        if source.tag is not None:
            age = _download_age(local_path(lists_dir, source), source.tag)
            remaining = 0 if age is None else interval - age
            delay = min(delay, max(0, remaining, retry_at.get(source.key, now) - now))
    return delay


def build(
    lists_dir: str, *, timeout: float = 120.0, opener=urllib.request.urlopen, max_age: float = 0,
    retry_at: dict[str, float] | None = None,
) -> dict[str, str]:
    """Download and rewrite every tagged list. Returns {key: "ok"|"kept"|"empty"}.

    A failed download keeps the previous file. If there is no previous file an
    empty one is written, so AdGuard can still start; the next refresh fills it.
    """
    write_static(lists_dir)
    result: dict[str, str] = {}
    for source in SOURCES:
        if source.tag is None:
            continue
        target = local_path(lists_dir, source)
        age = _download_age(target, source.tag) if max_age > 0 else None
        if (age is not None and age < max_age) or (
            retry_at is not None and time.time() < retry_at.get(source.key, 0)
        ):
            result[source.key] = "kept"
            continue
        tmp = None
        try:
            request = urllib.request.Request(source.url, headers={"User-Agent": "plainphone-ppdns"})
            with opener(request, timeout=timeout) as response:
                lines = (raw.decode("utf-8", "replace") for raw in response)
                fd, tmp = tempfile.mkstemp(dir=lists_dir, prefix=f".{source.key}.")
                count = 0
                with os.fdopen(fd, "w", encoding="utf-8") as out:
                    for rule in tag_rules(lines, source.tag):
                        out.write(rule)
                        count += 1
            if count < 2:
                raise ValueError("downloaded list has no rules")
            os.chmod(tmp, 0o644)
            os.replace(tmp, target)
            result[source.key] = "ok"
            if retry_at is not None:
                retry_at.pop(source.key, None)
            log.info("list %s: %d rules", source.key, count - 1)
        except Exception as exc:  # noqa: BLE001 - keep serving with the old list
            if retry_at is not None:
                retry_at[source.key] = time.time() + max_age
            log.warning("list %s: download failed (%s)", source.key, exc)
            if os.path.exists(target):
                try:
                    if retag_file(target, source.tag):
                        log.warning("list %s: kept the old copy, now tagged %s", source.key, source.tag)
                except OSError as err:
                    log.warning("list %s: could not retag the old copy (%s)", source.key, err)
                result[source.key] = "kept"
            else:
                with open(target, "w", encoding="utf-8") as out:
                    out.write("! placeholder until the first successful download\n")
                result[source.key] = "empty"
        finally:
            if tmp is not None and os.path.exists(tmp):
                os.unlink(tmp)
    return result
