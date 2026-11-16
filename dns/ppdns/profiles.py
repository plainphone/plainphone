# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Plainphone authors
"""Profiles and categories: what a ClientID gets blocked, expressed as an AdGuard Home client.

A phone has a profile (`child` or `self`) and a set of blocked categories. The profile decides
what is always on; the categories are the parent's switches (the same six the server stores).

Always on, whatever the categories say
  all profiles   ads, tracking, malware, encrypted-DNS endpoints (HaGeZi Pro, OISD big, HaGeZi DoH)
  child          VPN/proxy/Tor bypass list and private relays (`privacy` service group), SafeSearch,
                 YouTube strict Restricted Mode
  self           SafeSearch and YouTube moderate Restricted Mode while `adult` is blocked

Default categories: child = all six, self = none. The category switches are:

  category   AdGuard blocked services (per-client `blocked_services`)    client tag -> list
  social     group `social_network` (incl. TikTok) without OnlyFans       -
  adult      onlyfans                                                     device_other -> OISD NSFW
  gambling   group `gambling`                                             os_other -> HaGeZi gambling
  games      group `gaming`                                               -
  dating     group `dating`                                               -
  video      twitch, vimeo, dailymotion, bigo_live (NOT YouTube)          -

A service that is named by one category is taken out of the groups of the others (OnlyFans is in
AdGuard's `social_network` group but belongs to `adult`). Read back, a category counts as blocked
when its tag or any of its services is on the client, so clients written by older versions are
understood: a child from before categories existed has every service and both tags, and so reads
as "all six blocked" (only `os_other` is missing; Service.upgrade_clients() adds it).
"""

from __future__ import annotations

import dataclasses
import re
import secrets
import string

from .lists import TAG_ADULT, TAG_CHILD, TAG_GAMBLING

PROFILES = ("child", "self")
CLIENT_PREFIX = "pp-"


@dataclasses.dataclass(frozen=True)
class Category:
    tag: str | None = None  # client tag that switches on this category's blocklist
    groups: tuple[str, ...] = ()  # AdGuard blocked-service groups
    services: tuple[str, ...] = ()  # single services, on top of the groups


CATEGORY_RULES: dict[str, Category] = {
    "social": Category(groups=("social_network",), services=("tiktok",)),
    "adult": Category(tag=TAG_ADULT, services=("onlyfans",)),
    "gambling": Category(tag=TAG_GAMBLING, groups=("gambling",)),
    "games": Category(groups=("gaming",)),
    "dating": Category(groups=("dating",)),
    "video": Category(services=("twitch", "vimeo", "dailymotion", "bigo_live")),
}
CATEGORIES = tuple(sorted(CATEGORY_RULES))  # the names the server uses (server/src/db/schema.ts)

# The child profile always blocks these, whatever the categories say.
BYPASS_GROUPS = ("privacy",)
BYPASS_SERVICES = ("icloud_private_relay",)
# Never blocked: YouTube stays reachable in Restricted mode (many schools use it); a parent
# can block it per phone with block_domains.
NEVER_BLOCKED = ("youtube",)

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


def default_categories(profile: str) -> set[str]:
    """What a new phone blocks when the request does not say: everything for child, nothing for self."""
    return set(CATEGORIES) if profile == "child" else set()


def clean_categories(value) -> set[str]:
    """Check a `blocked_categories` list from a request."""
    if not isinstance(value, (list, tuple, set, frozenset)) or not all(isinstance(v, str) for v in value):
        raise ValueError("blocked_categories must be a list of category names")
    unknown = sorted(set(value) - set(CATEGORIES))
    if unknown:
        raise ValueError(f"unknown category {unknown[0]!r}; must be one of {', '.join(CATEGORIES)}")
    return set(value)


def resolve_categories(base: set[str], blocked_categories=None, block_adult: bool | None = None) -> set[str]:
    """The category set a create or change request asks for, starting from `base`.

    `blocked_categories` replaces the set. `block_adult` is the older way to say the same for
    `adult` alone: it adds or removes it. Giving both is fine as long as they agree.
    """
    if blocked_categories is not None:
        categories = clean_categories(blocked_categories)
        if block_adult is not None and block_adult != ("adult" in categories):
            raise ValueError('block_adult and blocked_categories disagree about "adult"')
        return categories
    categories = set(base)
    if block_adult is True:
        categories.add("adult")
    elif block_adult is False:
        categories.discard("adult")
    return categories


def missing_groups(all_services: list[dict]) -> list[str]:
    """Service groups we rely on that AdGuard's catalogue does not have (an AdGuard upgrade renamed them)."""
    have = {s.get("group_id") for s in all_services}
    wanted = {g for c in CATEGORY_RULES.values() for g in c.groups} | set(BYPASS_GROUPS)
    return sorted(wanted - have)


def category_services(category: str, all_services: list[dict]) -> set[str]:
    """AdGuard service ids behind one category, from AdGuard's own catalogue (/control/blocked_services/all)."""
    rule = CATEGORY_RULES[category]
    known = {s["id"] for s in all_services}
    ids = {s["id"] for s in all_services if s.get("group_id") in rule.groups}
    ids.update(s for s in rule.services if s in known)
    for other, other_rule in CATEGORY_RULES.items():
        if other != category:
            ids.difference_update(other_rule.services)  # a service named by another category is theirs
    ids.difference_update(NEVER_BLOCKED)
    return ids


def bypass_services(all_services: list[dict]) -> set[str]:
    ids = {s["id"] for s in all_services if s.get("group_id") in BYPASS_GROUPS}
    ids.update(s["id"] for s in all_services if s["id"] in BYPASS_SERVICES)
    ids.difference_update(NEVER_BLOCKED)
    return ids


def blocked_services(profile: str, categories: set[str], all_services: list[dict]) -> list[str]:
    ids: set[str] = set()
    for category in categories:
        ids |= category_services(category, all_services)
    if profile == "child":
        ids |= bypass_services(all_services)
    return sorted(ids)


def client_tags(profile: str, categories: set[str]) -> list[str]:
    tags = [TAG_CHILD] if profile == "child" else []
    tags += sorted(rule.tag for key, rule in CATEGORY_RULES.items() if key in categories and rule.tag)
    return tags


def categories_of(client: dict, all_services: list[dict]) -> set[str]:
    """The blocked categories of a stored AdGuard client (see the module docstring for legacy clients)."""
    tags = set(client.get("tags") or [])
    services = set(client.get("blocked_services") or [])
    return {
        key
        for key, rule in CATEGORY_RULES.items()
        if (rule.tag and rule.tag in tags) or services & category_services(key, all_services)
    }


def client_payload(client_id: str, profile: str, categories: set[str], all_services: list[dict]) -> dict:
    """The AdGuard Home persistent-client object for one phone."""
    if profile not in PROFILES:
        raise ValueError(f"unknown profile {profile!r}")
    categories = clean_categories(categories)
    return {
        "name": CLIENT_PREFIX + client_id,
        "ids": [client_id],
        "tags": client_tags(profile, categories),
        "use_global_settings": False,
        "filtering_enabled": True,
        "parental_enabled": False,  # uses an external AdGuard lookup; our own lists cover it
        "safebrowsing_enabled": False,
        "safe_search": {
            "enabled": profile == "child" or "adult" in categories,  # always for a child
            "bing": True,
            "duckduckgo": True,
            "ecosia": True,
            "google": True,
            "pixabay": True,
            "yandex": True,
            "youtube": True,
        },
        "use_global_blocked_services": False,
        "blocked_services": blocked_services(profile, categories, all_services),
        "blocked_services_schedule": {"time_zone": "UTC"},
        "upstreams": [],
        "upstreams_cache_enabled": False,
        "ignore_querylog": True,
        "ignore_statistics": False,
    }


def describe(client: dict, domain: str, all_services: list[dict]) -> dict:
    """Public view of an AdGuard client, as returned by the ppdns API."""
    client_id = client["name"][len(CLIENT_PREFIX):]
    tags = client.get("tags") or []
    categories = categories_of(client, all_services)
    return {
        "client_id": client_id,
        "hostname": f"{client_id}.{domain}",
        "profile": "child" if TAG_CHILD in tags else "self",
        "blocked_categories": sorted(categories),
        "block_adult": "adult" in categories,
    }
