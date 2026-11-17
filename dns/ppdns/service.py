# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Plainphone authors
"""The ppdns operations: create, read, change and delete one phone's ClientID.

AdGuard Home's own config is the only state. A phone is a persistent client
named `pp-<ClientID>`; its profile and blocked categories are stored as client
tags and blocked services (see profiles.py), and its extra allowed/blocked
domains are user rules with `$client='pp-<ClientID>'`.
Only registered ClientIDs may use the resolver (AdGuard's allowed_clients).
"""

from __future__ import annotations

import logging
import os
import threading

from . import helplines, profiles
from .adguard import AdGuard, AdGuardError

log = logging.getLogger("ppdns.service")


class NotFound(LookupError):
    pass


class Conflict(ValueError):
    """The ClientID is already registered."""


# Always in AdGuard's allowed_clients. An empty list would mean "everyone may
# query", so the list must never be empty, even with no phones registered.
ACCESS_SENTINEL = "plainphone-no-such-client"


class Service:
    def __init__(self, adguard: AdGuard, domain: str, data_dir: str):
        self.adguard = adguard
        self.domain = domain
        self.data_dir = data_dir
        self._lock = threading.Lock()  # AdGuard's user rules and access list are read-modify-write
        self._catalogue: list[dict] | None = None

    # helpers --------------------------------------------------------------
    def _services(self) -> list[dict]:
        if self._catalogue is None:
            catalogue = self.adguard.blocked_services_catalogue()
            missing = profiles.missing_groups(catalogue)
            if missing:  # fail closed: a phone with no services blocked would look protected
                raise AdGuardError(502, f"blocked-services catalogue has no group {', '.join(missing)}")
            self._catalogue = catalogue
        return self._catalogue

    def _find(self, client_id: str) -> dict:
        if not profiles.valid_client_id(client_id):
            raise NotFound(client_id)
        name = profiles.CLIENT_PREFIX + client_id
        for client in self.adguard.clients():
            if client.get("name") == name:
                return client
        raise NotFound(client_id)

    def _ours(self) -> list[dict]:
        return [c for c in self.adguard.clients() if str(c.get("name", "")).startswith(profiles.CLIENT_PREFIX)]

    @staticmethod
    def _rule_suffix(client_id: str) -> str:
        return f"$client='{profiles.CLIENT_PREFIX}{client_id}',important"

    def _domains(self, rules: list[str], client_id: str) -> tuple[list[str], list[str]]:
        suffix = self._rule_suffix(client_id)
        allow, block = [], []
        for rule in rules:
            if not rule.endswith(suffix):
                continue
            body = rule[: -len(suffix)]
            if body.startswith("@@||") and body.endswith("^"):
                allow.append(body[4:-1])
            elif body.startswith("||") and body.endswith("^"):
                block.append(body[2:-1])
        return sorted(allow), sorted(block)

    @staticmethod
    def _clean(allow, block):
        """Normalise and check domain lists before anything is written. None means unchanged."""
        allow = None if allow is None else sorted({profiles.normalise_domain(d) for d in allow})
        block = None if block is None else sorted({profiles.normalise_domain(d) for d in block})
        if allow is not None and block is not None and set(allow) & set(block):
            raise ValueError("a domain cannot be both allowed and blocked")
        return allow, block

    def _set_domains(self, client_id: str, allow: list[str] | None, block: list[str] | None) -> None:
        suffix = self._rule_suffix(client_id)
        rules = self.adguard.user_rules()
        old_allow, old_block = self._domains(rules, client_id)
        allow = old_allow if allow is None else allow
        block = old_block if block is None else block
        if set(allow) & set(block):
            raise ValueError("a domain cannot be both allowed and blocked")
        if (allow, block) == (old_allow, old_block):
            return  # nothing changed: skip AdGuard's filter rebuild
        kept = [r for r in rules if not r.endswith(suffix)]
        kept += [f"@@||{d}^{suffix}" for d in allow]
        kept += [f"||{d}^{suffix}" for d in block]
        self.adguard.set_user_rules(kept)

    def install_helpline_rules(self) -> None:
        with self._lock:
            domains = helplines.domains()
            existing = self.adguard.user_rules()
            kept, previous = helplines.split_rules(existing)
            fixed = helplines.filter_rules(domains)
            self.adguard.exclude_from_stats(
                [f"||{domain}^" for domain in domains],
                obsolete=[f"||{domain}^" for domain in sorted(previous - set(domains))],
            )
            wanted = kept + fixed
            if wanted != existing:
                self.adguard.set_user_rules(wanted)

    def sync_access(self) -> int:
        """Allow exactly the registered ClientIDs. Returns how many."""
        ids = sorted({i for c in self._ours() for i in c.get("ids", [])} | {ACCESS_SENTINEL})
        access = self.adguard.access()
        wanted = {
            "allowed_clients": ids,
            "disallowed_clients": access.get("disallowed_clients") or [],
            "blocked_hosts": access.get("blocked_hosts") or [],
        }
        if sorted(access.get("allowed_clients") or []) != ids:
            self.adguard.set_access(wanted)
        return len(ids)

    def view(self, client: dict) -> dict:
        out = profiles.describe(client, self.domain, self._services())
        out["allow_domains"], out["block_domains"] = self._domains(self.adguard.user_rules(), out["client_id"])
        return out

    # operations -----------------------------------------------------------
    def create(
        self,
        profile: str,
        block_adult: bool | None = None,
        client_id: str | None = None,
        allow_domains: list[str] | None = None,
        block_domains: list[str] | None = None,
        *,
        blocked_categories: list[str] | None = None,
        internal: bool = False,
    ) -> dict:
        if profile not in profiles.PROFILES:
            raise ValueError(f"profile must be one of {', '.join(profiles.PROFILES)}")
        categories = profiles.resolve_categories(profiles.default_categories(profile), blocked_categories, block_adult)
        client_id = client_id or profiles.new_client_id()
        if not profiles.valid_client_id(client_id) or client_id == ACCESS_SENTINEL:
            raise ValueError("invalid client_id: 4-63 characters a-z, 0-9 and '-', starting with a letter or digit")
        if client_id.startswith(profiles.MONITOR_PREFIX) and not internal:
            raise ValueError(f"client_id may not start with {profiles.MONITOR_PREFIX!r}")
        allow, block = self._clean(allow_domains, block_domains)  # validate before writing anything
        if allow is not None and block is None:
            block = []
        if block is not None and allow is None:
            allow = []
        payload = profiles.client_payload(client_id, profile, categories, self._services())
        with self._lock:
            if any(client_id in c.get("ids", []) or c.get("name") == payload["name"] for c in self.adguard.clients()):
                raise Conflict(client_id)
            self.adguard.add_client(payload)
            if allow is not None:
                self._set_domains(client_id, allow, block)
            self.sync_access()
        return self.view(payload)

    def get(self, client_id: str) -> dict:
        return self.view(self._find(client_id))

    def list(self) -> list[dict]:
        rules = self.adguard.user_rules()
        services = self._services()
        result = []
        for client in self._ours():
            if client["name"].startswith(profiles.CLIENT_PREFIX + profiles.MONITOR_PREFIX):
                continue  # the self-test's own ClientID
            item = profiles.describe(client, self.domain, services)
            item["allow_domains"], item["block_domains"] = self._domains(rules, item["client_id"])
            result.append(item)
        return sorted(result, key=lambda c: c["client_id"])

    def update(
        self,
        client_id: str,
        profile: str | None = None,
        block_adult: bool | None = None,
        allow_domains: list[str] | None = None,
        block_domains: list[str] | None = None,
        blocked_categories: list[str] | None = None,
    ) -> dict:
        allow_domains, block_domains = self._clean(allow_domains, block_domains)  # before any write
        with self._lock:
            current = self._find(client_id)
            services = self._services()
            now = profiles.describe(current, self.domain, services)
            profile = profile or now["profile"]
            if profile not in profiles.PROFILES:
                raise ValueError(f"profile must be one of {', '.join(profiles.PROFILES)}")
            # A new profile starts from its own defaults; otherwise the phone keeps what it blocks now.
            base = set(now["blocked_categories"]) if profile == now["profile"] else profiles.default_categories(profile)
            categories = profiles.resolve_categories(base, blocked_categories, block_adult)
            payload = profiles.client_payload(client_id, profile, categories, services)
            if allow_domains is not None or block_domains is not None:
                # Check the overlap against the stored lists too, before anything is written.
                stored_allow, stored_block = self._domains(self.adguard.user_rules(), client_id)
                merged_allow = stored_allow if allow_domains is None else allow_domains
                merged_block = stored_block if block_domains is None else block_domains
                if set(merged_allow) & set(merged_block):
                    raise ValueError("a domain cannot be both allowed and blocked")
            self.adguard.update_client(current["name"], payload)
            if allow_domains is not None or block_domains is not None:
                self._set_domains(client_id, allow_domains, block_domains)
        return self.get(client_id)

    def delete(self, client_id: str) -> None:
        with self._lock:
            current = self._find(client_id)
            self.adguard.delete_client(current["name"])
            self._set_domains(client_id, [], [])
            self.sync_access()

    def upgrade_clients(self) -> int:
        """Add the tags that clients written by an older ppdns lack. Returns how many were changed.

        The gambling list used to apply through the child tag. It now has a tag of its own, and
        a child from before that has the gambling services but not the tag. Reading such a client
        already says "gambling blocked" (profiles.categories_of); this makes it true for the list.
        """
        changed = 0
        with self._lock:
            services = self._services()
            for client in self._ours():
                client_id = client["name"][len(profiles.CLIENT_PREFIX):]
                profile = "child" if profiles.TAG_CHILD in (client.get("tags") or []) else "self"
                payload = profiles.client_payload(client_id, profile, profiles.categories_of(client, services), services)
                if set(payload["tags"]) - set(client.get("tags") or []):
                    self.adguard.update_client(client["name"], payload)
                    changed += 1
        if changed:
            log.info("added the new category tags to %d existing clients", changed)
        return changed

    # monitoring client ----------------------------------------------------
    def ensure_monitor_client(self) -> str:
        """A child-profile ClientID used only by the self-test. Kept in the data dir."""
        path = os.path.join(self.data_dir, "monitor-client-id")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                client_id = fh.read().strip()
        else:
            client_id = profiles.MONITOR_PREFIX + profiles.new_client_id(16)
            os.makedirs(self.data_dir, exist_ok=True)
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(client_id + "\n")
        try:
            self._find(client_id)
        except NotFound:
            try:
                self.create("child", client_id=client_id, internal=True)
            except AdGuardError as exc:
                log.warning("could not create monitor client: %s", exc)
        return client_id
