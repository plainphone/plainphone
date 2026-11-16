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
import urllib.request

log = logging.getLogger("ppdns.lists")

# AdGuard Home has a fixed set of client tags. Plainphone uses two of them as flags.
TAG_CHILD = "user_child"  # child profile: gambling and bypass lists, social media services
TAG_ADULT = "device_other"  # adult content is blocked for this client (child, or self by choice)

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
    # Adult content: child always, self when the owner chooses it.
    Source("oisd-nsfw", "OISD NSFW (adult content)", "https://nsfw.oisd.nl/", TAG_ADULT),
    # Child only.
    Source("hagezi-gambling", "HaGeZi gambling (medium)", f"{HAGEZI}/gambling.medium.txt", TAG_CHILD),
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
    yield f"! Rewritten by Plainphone ppdns: every rule applies only to clients tagged {tag}\n"
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


def build(lists_dir: str, *, timeout: float = 120.0, opener=urllib.request.urlopen) -> dict[str, str]:
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
                os.unlink(tmp)
                raise ValueError("downloaded list has no rules")
            os.chmod(tmp, 0o644)
            os.replace(tmp, target)
            result[source.key] = "ok"
            log.info("list %s: %d rules", source.key, count - 1)
        except Exception as exc:  # noqa: BLE001 - keep serving with the old list
            log.warning("list %s: download failed (%s)", source.key, exc)
            if os.path.exists(target):
                result[source.key] = "kept"
            else:
                with open(target, "w", encoding="utf-8") as out:
                    out.write("! placeholder until the first successful download\n")
                result[source.key] = "empty"
    return result
