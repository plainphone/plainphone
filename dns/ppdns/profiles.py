# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Plainphone authors
"""Profiles: what a ClientID gets blocked, expressed as an AdGuard Home client.

| Profile | Lists                                  | Services blocked                     | SafeSearch, YouTube Restricted |
|---------|----------------------------------------|--------------------------------------|--------------------------------|
| child   | global + adult + gambling + bypass     | social, games, gambling, dating,     | always on                      |
|         |                                        | video sites (not YouTube), VPN/relay |                                |
| self    | global (+ adult if block_adult)        | none by default                      | on if block_adult              |

"Global" means ads, tracking, malware and encrypted-DNS endpoints (HaGeZi Pro,
OISD big, HaGeZi DoH). Everything else is opt-in per client via tags.
"""

from __future__ import annotations

import re
import secrets
import string

from .lists import TAG_ADULT, TAG_CHILD

PROFILES = ("child", "self")
CLIENT_PREFIX = "pp-"

# AdGuard blocked-service groups that are blocked for the child profile.
CHILD_BLOCKED_GROUPS = ("social_network", "gaming", "gambling", "dating", "privacy")
# Single services blocked for the child profile on top of the groups.
CHILD_BLOCKED_SERVICES = (
    "tiktok",
    "twitch",
    "bigo_live",
    "dailymotion",
    "vimeo",
    "onlyfans",
    "icloud_private_relay",
)
# Never blocked by default for the child: YouTube stays reachable in Restricted
# mode (many schools use it); a parent can still block it per phone in phase 3.
CHILD_NEVER_BLOCKED = ("youtube",)

CLIENT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{3,62}$")
# Same TLD rule as the server (server/src/lib/validation.ts): a letter, then up to 62 of [a-z0-9-].
DOMAIN_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z][a-z0-9-]{0,62}$")
MONITOR_PREFIX = "monitor-"  # reserved for the self-test's own ClientID
_ALPHABET = string.ascii_lowercase + string.digits


def new_client_id(length: int = 20) -> str:
    """Random, unguessable ClientID (about 103 bits). It ends up in the DoT hostname."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def valid_client_id(value: str) -> bool:
    return bool(CLIENT_ID_RE.match(value))


def normalise_domain(value: str) -> str:
    domain = value.strip().lower().rstrip(".")
    if domain.startswith("*."):
        domain = domain[2:]
    if not DOMAIN_RE.match(domain):
        raise ValueError(f"not a domain name: {value!r}")
    return domain


def child_blocked_services(all_services: list[dict]) -> list[str]:
    """Service ids for the child profile, from AdGuard's own catalogue (/control/blocked_services/all)."""
    known = {service["id"] for service in all_services}
    ids = {s["id"] for s in all_services if s.get("group_id") in CHILD_BLOCKED_GROUPS}
    ids.update(s for s in CHILD_BLOCKED_SERVICES if s in known)
    ids.difference_update(CHILD_NEVER_BLOCKED)
    return sorted(ids)


def client_payload(client_id: str, profile: str, block_adult: bool, all_services: list[dict]) -> dict:
    """The AdGuard Home persistent-client object for one phone."""
    if profile not in PROFILES:
        raise ValueError(f"unknown profile {profile!r}")
    if profile == "child":
        block_adult = True  # not optional for children
    tags = []
    if profile == "child":
        tags.append(TAG_CHILD)
    if block_adult:
        tags.append(TAG_ADULT)
    safe = block_adult
    return {
        "name": CLIENT_PREFIX + client_id,
        "ids": [client_id],
        "tags": tags,
        "use_global_settings": False,
        "filtering_enabled": True,
        "parental_enabled": False,  # uses an external AdGuard lookup; our own lists cover it
        "safebrowsing_enabled": False,
        "safe_search": {
            "enabled": safe,
            "bing": True,
            "duckduckgo": True,
            "ecosia": True,
            "google": True,
            "pixabay": True,
            "yandex": True,
            "youtube": True,
        },
        "use_global_blocked_services": False,
        "blocked_services": child_blocked_services(all_services) if profile == "child" else [],
        "blocked_services_schedule": {"time_zone": "UTC"},
        "upstreams": [],
        "upstreams_cache_enabled": False,
        "ignore_querylog": True,
        "ignore_statistics": False,
    }


def describe(client: dict, domain: str) -> dict:
    """Public view of an AdGuard client, as returned by the ppdns API."""
    client_id = client["name"][len(CLIENT_PREFIX):]
    tags = client.get("tags") or []
    return {
        "client_id": client_id,
        "hostname": f"{client_id}.{domain}",
        "profile": "child" if TAG_CHILD in tags else "self",
        "block_adult": TAG_ADULT in tags,
    }
