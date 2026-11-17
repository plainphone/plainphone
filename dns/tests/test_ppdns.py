# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Plainphone authors
"""Unit tests for ppdns. No network, no AdGuard: a fake stands in for its API.

Run: python3 -m unittest discover -s dns/tests -p 'test_ppdns.py' -v
"""

from __future__ import annotations

import io
import json
import os
import sys
import tarfile
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from dataclasses import replace
from http.server import ThreadingHTTPServer
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ppdns import config, dot, lists, profiles  # noqa: E402
from ppdns.server import Api  # noqa: E402
from ppdns import service as service_mod  # noqa: E402
from ppdns.adguard import AdGuardError  # noqa: E402
from ppdns.service import NotFound, Service  # noqa: E402

# A cut-down copy of AdGuard Home's /control/blocked_services/all. Like the real one, it puts
# OnlyFans in `social_network` and Twitch, Vimeo, YouTube and the rest in `streaming`.
CATALOGUE = [
    {"id": "instagram", "group_id": "social_network"},
    {"id": "tiktok", "group_id": "social_network"},
    {"id": "onlyfans", "group_id": "social_network"},
    {"id": "steam", "group_id": "gaming"},
    {"id": "betway", "group_id": "gambling"},
    {"id": "tinder", "group_id": "dating"},
    {"id": "proton", "group_id": "privacy"},
    {"id": "icloud_private_relay", "group_id": "privacy"},
    {"id": "youtube", "group_id": "streaming"},
    {"id": "twitch", "group_id": "streaming"},
    {"id": "vimeo", "group_id": "streaming"},
    {"id": "dailymotion", "group_id": "streaming"},
    {"id": "bigo_live", "group_id": "streaming"},
    {"id": "spotify", "group_id": "streaming"},
    {"id": "whatsapp", "group_id": "messenger"},
]

# What the first ppdns release (before categories) stored in AdGuard for each kind of phone:
# the child got every service of five groups plus six single ones, and the tags user_child and
# device_other. Written out by hand so it stays what old installs really contain.
LEGACY_CHILD_SERVICES = [
    "betway", "bigo_live", "dailymotion", "icloud_private_relay", "instagram", "onlyfans", "proton",
    "steam", "tiktok", "tinder", "twitch", "vimeo",
]


def legacy_client(client_id, tags, services=()):
    """An AdGuard client as the first ppdns release wrote it."""
    return {
        "name": "pp-" + client_id, "ids": [client_id], "tags": list(tags), "blocked_services": list(services),
        "use_global_settings": False, "filtering_enabled": True,
        "safe_search": {"enabled": "device_other" in tags, "youtube": True},
    }


class FakeAdGuard:
    def __init__(self):
        self._clients: dict[str, dict] = {}
        self.rules: list[str] = ["||manual.example^"]
        self.access_state = {"allowed_clients": [], "disallowed_clients": ["1.2.3.4"], "blocked_hosts": ["version.bind"]}
        self.refreshed = 0
        self.filter_list = [{"url": "https://big.oisd.nl/", "name": "OISD big"}]

    def status(self):
        return {"running": True}

    def clients(self):
        return [dict(c) for c in self._clients.values()]

    def add_client(self, client):
        assert client["name"] not in self._clients
        self._clients[client["name"]] = dict(client, tags=sorted(client.get("tags") or []))  # AdGuard sorts tags

    def update_client(self, name, client):
        del self._clients[name]
        self._clients[client["name"]] = dict(client, tags=sorted(client.get("tags") or []))

    def delete_client(self, name):
        del self._clients[name]

    def blocked_services_catalogue(self):
        return CATALOGUE

    def access(self):
        return dict(self.access_state)

    def set_access(self, access):
        self.access_state = dict(access)

    def user_rules(self):
        return list(self.rules)

    def set_user_rules(self, rules):
        self.rules = list(rules)

    def filters(self):
        return list(self.filter_list)

    def add_filter(self, name, url):
        self.filter_list.append({"url": url, "name": name})

    def refresh_filters(self):
        self.refreshed += 1


class TagRulesTest(unittest.TestCase):
    def test_rules_get_the_tag_and_comments_are_dropped(self):
        source = ["[Adblock Plus]", "! Title: x", "# hosts comment", "", "||porn.example^", "||a.example^$important",
                  "@@||ok.example^", "0.0.0.0 hosts.example", "bare.example", "||c.example^$client=1.2.3.4",
                  "/regex/", "0.0.0.0 localhost"]
        out = list(lists.tag_rules(source, "user_child"))
        self.assertTrue(out[0].startswith("!"))
        self.assertEqual(
            out[1:],
            [
                "||porn.example^$ctag=user_child\n",
                "||a.example^$important,ctag=user_child\n",
                "@@||ok.example^$ctag=user_child\n",
                "||hosts.example^$ctag=user_child\n",
                "||bare.example^$ctag=user_child\n",
            ],
        )

    def test_failed_download_keeps_old_file_or_writes_placeholder(self):
        def broken(*_args, **_kwargs):
            raise OSError("offline")

        with tempfile.TemporaryDirectory() as tmp:
            result = lists.build(tmp, opener=broken)
            self.assertEqual(set(result.values()), {"empty"})
            for source in lists.SOURCES:
                if source.tag:
                    self.assertTrue(os.path.exists(lists.local_path(tmp, source)))
            self.assertEqual(set(lists.build(tmp, opener=broken).values()), {"kept"})

    def test_download_is_rewritten(self):
        class Response(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        with tempfile.TemporaryDirectory() as tmp:
            result = lists.build(tmp, opener=lambda *_a, **_k: Response(b"! c\n||x.example^\n"))
            self.assertEqual(set(result.values()), {"ok"})
            nsfw = next(s for s in lists.SOURCES if s.key == "oisd-nsfw")
            with open(lists.local_path(tmp, nsfw)) as fh:
                self.assertIn("||x.example^$ctag=device_other\n", fh.read())

    def test_every_list_gets_the_tag_of_its_category(self):
        class Response(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        self.assertEqual(
            {s.key: s.tag for s in lists.SOURCES},
            {
                "hagezi-pro": None,
                "oisd-big": None,
                "hagezi-doh": None,
                "oisd-nsfw": "device_other",  # category adult
                "hagezi-gambling": "os_other",  # category gambling
                "hagezi-bypass": "user_child",  # child profile, not switchable
            },
        )
        with tempfile.TemporaryDirectory() as tmp:
            lists.build(tmp, opener=lambda *_a, **_k: Response(b"||x.example^\n"))
            for source in lists.SOURCES:
                if source.tag:
                    with open(lists.local_path(tmp, source)) as fh:
                        self.assertEqual(fh.read().splitlines()[2], f"||x.example^$ctag={source.tag}", source.key)

    def test_tags_are_ones_adguard_accepts_and_do_not_collide(self):
        # allowedTags in AdGuard Home internal/client/storage.go
        allowed = {
            "device_audio", "device_camera", "device_gameconsole", "device_laptop", "device_nas", "device_other",
            "device_pc", "device_phone", "device_printer", "device_securityalarm", "device_tablet", "device_tv",
            "os_android", "os_ios", "os_linux", "os_macos", "os_other", "os_windows",
            "user_admin", "user_child", "user_regular",
        }
        mine = [lists.TAG_CHILD, lists.TAG_ADULT, lists.TAG_GAMBLING]
        self.assertEqual(len(set(mine)), 3)
        self.assertTrue(set(mine) <= allowed)
        self.assertTrue(all(c.tag is None or c.tag in mine for c in profiles.CATEGORY_RULES.values()))

    def test_init_reuses_only_fresh_tagged_downloads(self):
        with tempfile.TemporaryDirectory() as tmp:
            sources = [s for s in lists.SOURCES if s.tag]
            calls = []

            def opener(request, **kwargs):
                calls.append(request.full_url)
                return io.BytesIO(b"example.org\n")

            lists.build(tmp, opener=opener, max_age=3600)
            self.assertEqual(calls, [s.url for s in sources])
            calls.clear()
            lists.build(tmp, opener=opener, max_age=3600)
            self.assertEqual(calls, [])
            os.utime(lists.local_path(tmp, sources[0]), (1, 1))
            with open(lists.local_path(tmp, sources[1]), "w", encoding="utf-8") as out:
                out.write("! placeholder until the first successful download\n")
            lists.build(tmp, opener=opener, max_age=3600)
            self.assertEqual(calls, [s.url for s in sources[:2]])

    def test_fresh_download_requires_matching_format_and_source_url(self):
        source = next(s for s in lists.SOURCES if s.tag)
        changed = replace(source, url=source.url + "?updated")
        calls = []

        def opener(request, **kwargs):
            calls.append(request.full_url)
            return io.BytesIO(b"example.org\n")

        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(lists, "SOURCES", [source]):
                lists.build(tmp, opener=opener, max_age=3600)
            with patch.object(lists, "SOURCES", [changed]):
                self.assertEqual(lists.refresh_delay(tmp, 3600, {}), 0)
                lists.build(tmp, opener=opener, max_age=3600)
                path = lists.local_path(tmp, changed)
                with open(path, encoding="utf-8") as fh:
                    tag_header, metadata, *rules = fh.readlines()
                self.assertNotIn(changed.url, metadata)
                with open(path, "w", encoding="utf-8") as fh:
                    fh.writelines([tag_header, metadata.replace("format=1", "format=0"), *rules])
                self.assertEqual(lists.refresh_delay(tmp, 3600, {}), 0)
                lists.build(tmp, opener=opener, max_age=3600)
            self.assertEqual(calls, [source.url, changed.url, changed.url])

    def test_old_gambling_list_is_retagged_when_the_download_fails(self):
        def broken(*_args, **_kwargs):
            raise OSError("offline")

        gambling = next(s for s in lists.SOURCES if s.key == "hagezi-gambling")
        with tempfile.TemporaryDirectory() as tmp:
            path = lists.local_path(tmp, gambling)
            with open(path, "w") as fh:  # as the first release wrote it
                fh.write("! Rewritten by Plainphone ppdns: every rule applies only to clients tagged user_child\n")
                fh.write("||bet.example^$ctag=user_child\n||b.example^$important,ctag=user_child\n")
            self.assertEqual(lists.build(tmp, opener=broken)["hagezi-gambling"], "kept")
            with open(path) as fh:
                self.assertEqual(
                    fh.read(),
                    "! Rewritten by Plainphone ppdns: every rule applies only to clients tagged os_other\n"
                    "||bet.example^$ctag=os_other\n||b.example^$important,ctag=os_other\n",
                )
            self.assertFalse(lists.retag_file(path, "os_other"))  # already right: left alone
            with open(path, "w") as fh:
                fh.write("! somebody else's list\n||x.example^$ctag=user_child\n")
            self.assertFalse(lists.retag_file(path, "os_other"))  # not ours: left alone

    def test_global_lists_are_urls_and_tagged_lists_are_local_files(self):
        for source in lists.SOURCES:
            url = lists.filter_url("/w/userfilters", source)
            self.assertEqual(url.startswith("/w/userfilters/"), source.tag is not None)


class ProfilesTest(unittest.TestCase):
    def test_child_profile(self):
        payload = profiles.client_payload("abcd1234", "child", set(profiles.CATEGORIES), CATALOGUE)
        self.assertEqual(payload["name"], "pp-abcd1234")
        self.assertEqual(payload["ids"], ["abcd1234"])
        self.assertEqual(payload["tags"], [lists.TAG_CHILD, lists.TAG_ADULT, lists.TAG_GAMBLING])
        self.assertTrue(payload["safe_search"]["enabled"] and payload["safe_search"]["youtube"])
        self.assertEqual(payload["blocked_services"], LEGACY_CHILD_SERVICES)  # exactly what it was before categories
        self.assertFalse(payload["use_global_settings"])
        self.assertTrue(payload["ignore_querylog"])

    def test_self_profile(self):
        payload = profiles.client_payload("abcd1234", "self", set(), CATALOGUE)
        self.assertEqual(payload["tags"], [])
        self.assertFalse(payload["safe_search"]["enabled"])
        self.assertEqual(payload["blocked_services"], [])
        adult = profiles.client_payload("abcd1234", "self", {"adult"}, CATALOGUE)
        self.assertEqual(adult["tags"], [lists.TAG_ADULT])
        self.assertTrue(adult["safe_search"]["enabled"])
        self.assertEqual(adult["blocked_services"], ["onlyfans"])

    def test_category_to_service_mapping(self):
        expected = {
            "social": {"instagram", "tiktok"},  # OnlyFans is in AdGuard's social group but belongs to adult
            "adult": {"onlyfans"},
            "gambling": {"betway"},
            "games": {"steam"},
            "dating": {"tinder"},
            "video": {"twitch", "vimeo", "dailymotion", "bigo_live"},  # not YouTube
        }
        self.assertEqual(set(expected), set(profiles.CATEGORIES))
        for category, services in expected.items():
            self.assertEqual(profiles.category_services(category, CATALOGUE), services, category)
            self.assertEqual(
                profiles.client_payload("abcd1234", "self", {category}, CATALOGUE)["blocked_services"],
                sorted(services),
                category,
            )

    def test_category_to_tag_mapping(self):
        tags = {c: profiles.client_payload("abcd1234", "self", {c}, CATALOGUE)["tags"] for c in profiles.CATEGORIES}
        self.assertEqual(
            tags,
            {"adult": ["device_other"], "gambling": ["os_other"], "social": [], "games": [], "dating": [], "video": []},
        )

    def test_server_category_names(self):
        self.assertEqual(profiles.CATEGORIES, ("adult", "dating", "gambling", "games", "social", "video"))

    def test_child_keeps_bypass_and_safesearch_with_every_category_unblocked(self):
        payload = profiles.client_payload("abcd1234", "child", set(), CATALOGUE)
        self.assertEqual(payload["tags"], [lists.TAG_CHILD])  # bypass list and YouTube strict ride on this
        self.assertEqual(payload["blocked_services"], ["icloud_private_relay", "proton"])
        self.assertTrue(payload["safe_search"]["enabled"])

    def test_safesearch_for_self_only_with_adult(self):
        for category in profiles.CATEGORIES:
            enabled = profiles.client_payload("abcd1234", "self", {category}, CATALOGUE)["safe_search"]["enabled"]
            self.assertEqual(enabled, category == "adult", category)

    def test_youtube_is_never_blocked(self):
        everything = set(profiles.CATEGORIES)
        for profile in profiles.PROFILES:
            self.assertNotIn("youtube", profiles.client_payload("abcd1234", profile, everything, CATALOGUE)["blocked_services"])

    def test_categories_read_back_for_every_combination(self):
        import itertools

        for profile in profiles.PROFILES:
            for size in range(len(profiles.CATEGORIES) + 1):
                for combo in itertools.combinations(profiles.CATEGORIES, size):
                    stored = profiles.client_payload("abcd1234", profile, set(combo), CATALOGUE)
                    self.assertEqual(profiles.categories_of(stored, CATALOGUE), set(combo), (profile, combo))
                    out = profiles.describe(stored, "dns.example.org", CATALOGUE)
                    self.assertEqual(out["blocked_categories"], sorted(combo))
                    self.assertEqual(out["block_adult"], "adult" in combo)
                    self.assertEqual(out["profile"], profile)

    def test_clients_from_before_categories_read_back_unchanged(self):
        child = legacy_client("abcd1234", ["user_child", "device_other"], LEGACY_CHILD_SERVICES)
        self.assertEqual(profiles.categories_of(child, CATALOGUE), set(profiles.CATEGORIES))
        self.assertEqual(profiles.describe(child, "d", CATALOGUE)["profile"], "child")
        self.assertEqual(profiles.categories_of(legacy_client("abcd1234", []), CATALOGUE), set())
        self.assertEqual(profiles.categories_of(legacy_client("abcd1234", ["device_other"]), CATALOGUE), {"adult"})

    def test_resolve_categories(self):
        resolve = profiles.resolve_categories
        self.assertEqual(resolve({"social"}), {"social"})  # nothing said: unchanged
        self.assertEqual(resolve({"social"}, None, True), {"social", "adult"})
        self.assertEqual(resolve({"social", "adult"}, None, False), {"social"})
        self.assertEqual(resolve({"social"}, ["games", "games"]), {"games"})  # replaces, duplicates collapse
        self.assertEqual(resolve({"social"}, []), set())
        self.assertEqual(resolve(set(), ["adult"], True), {"adult"})  # both given and in agreement
        self.assertEqual(resolve({"adult"}, ["social"], False), {"social"})
        for blocked, adult in ((["social"], True), (["adult"], False)):
            with self.assertRaises(ValueError, msg=(blocked, adult)):
                resolve(set(), blocked, adult)
        for bad in (["porn"], ["Social"], [""], "social", [1], {"a": 1}):
            with self.assertRaises(ValueError, msg=bad):
                resolve(set(), bad)

    def test_catalogue_without_our_groups_is_noticed(self):
        self.assertEqual(profiles.missing_groups(CATALOGUE), [])
        self.assertEqual(profiles.missing_groups([s for s in CATALOGUE if s["group_id"] != "gaming"]), ["gaming"])
        self.assertEqual(len(profiles.missing_groups([])), 5)

    def test_client_ids(self):
        ids = {profiles.new_client_id() for _ in range(200)}
        self.assertEqual(len(ids), 200)
        self.assertTrue(all(profiles.valid_client_id(i) and len(i) == 20 for i in ids))
        for bad in ("", "ab", "UPPER", "a.b", "a" * 70, "-abc", "a b c"):
            self.assertFalse(profiles.valid_client_id(bad), bad)

    def test_domains(self):
        self.assertEqual(profiles.normalise_domain(" Example.COM. "), "example.com")
        self.assertEqual(profiles.normalise_domain("*.example.com"), "example.com")
        for bad in ("", "example", "exa mple.com", "||x.com^", "x.com$client=a", "a/b.com"):
            with self.assertRaises(ValueError, msg=bad):
                profiles.normalise_domain(bad)


class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ag = FakeAdGuard()
        self.svc = Service(self.ag, "dns.example.org", self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_create_registers_client_and_access_list(self):
        out = self.svc.create("child")
        self.assertEqual(out["profile"], "child")
        self.assertTrue(out["block_adult"])
        self.assertEqual(out["hostname"], out["client_id"] + ".dns.example.org")
        self.assertEqual(
            self.ag.access_state["allowed_clients"], sorted([out["client_id"], service_mod.ACCESS_SENTINEL])
        )
        self.assertEqual(self.ag.access_state["disallowed_clients"], ["1.2.3.4"])  # untouched

    def test_self_default_allows_adult(self):
        self.assertFalse(self.svc.create("self")["block_adult"])
        self.assertTrue(self.svc.create("self", True)["block_adult"])

    def test_unknown_profile_rejected(self):
        with self.assertRaises(ValueError):
            self.svc.create("teen")

    def test_domains_are_per_client_and_keep_manual_rules(self):
        a = self.svc.create("self")["client_id"]
        b = self.svc.create("self")["client_id"]
        self.svc.update(a, allow_domains=["Ok.example"], block_domains=["bad.example"])
        self.svc.update(b, block_domains=["other.example"])
        self.assertEqual(self.svc.get(a)["allow_domains"], ["ok.example"])
        self.assertEqual(self.svc.get(a)["block_domains"], ["bad.example"])
        self.assertEqual(self.svc.get(b)["block_domains"], ["other.example"])
        self.assertIn("||manual.example^", self.ag.rules)
        self.assertIn(f"||bad.example^$client='pp-{a}',important", self.ag.rules)
        # only allow given: block list stays
        self.svc.update(a, allow_domains=[])
        self.assertEqual(self.svc.get(a)["block_domains"], ["bad.example"])
        with self.assertRaises(ValueError):
            self.svc.update(a, allow_domains=["x.example"], block_domains=["x.example"])

    def test_access_list_is_never_empty(self):
        a = self.svc.create("self")["client_id"]
        self.svc.delete(a)
        self.assertEqual(self.ag.access_state["allowed_clients"], [service_mod.ACCESS_SENTINEL])

    def test_bad_domain_writes_nothing(self):
        with self.assertRaises(ValueError):
            self.svc.create("child", block_domains=["ok.example", "not a domain"])
        self.assertEqual(self.ag.clients(), [])
        self.assertEqual(self.ag.access_state["allowed_clients"], [])  # never touched
        a = self.svc.create("self")["client_id"]
        with self.assertRaises(ValueError):
            self.svc.update(a, profile="child", allow_domains=["bad domain"])
        self.assertEqual(self.svc.get(a)["profile"], "self")  # profile not half-applied
        b = self.svc.create("self", block_domains=["x.example"])["client_id"]
        with self.assertRaises(ValueError):  # overlaps the stored block list
            self.svc.update(b, profile="child", allow_domains=["x.example"])
        self.assertEqual(self.svc.get(b)["profile"], "self")

    def test_one_letter_tld_like_the_server(self):
        self.assertEqual(profiles.normalise_domain("x.y"), "x.y")
        with self.assertRaises(ValueError):
            profiles.normalise_domain("x.1")

    def test_monitor_prefix_is_reserved(self):
        with self.assertRaises(ValueError):
            self.svc.create("child", client_id="monitor-abcd")

    def test_unchanged_domains_do_not_rewrite_rules(self):
        a = self.svc.create("self", block_domains=["bad.example"])["client_id"]
        calls = []
        self.ag.set_user_rules = lambda rules: calls.append(rules)
        self.svc.update(a, block_domains=["bad.example"])
        self.assertEqual(calls, [])

    def test_rule_injection_is_rejected(self):
        a = self.svc.create("self")["client_id"]
        with self.assertRaises(ValueError):
            self.svc.update(a, allow_domains=["x.com^$client='pp-other'"])

    def test_profile_change(self):
        a = self.svc.create("self")["client_id"]
        out = self.svc.update(a, profile="child")
        self.assertEqual((out["profile"], out["block_adult"]), ("child", True))
        out = self.svc.update(a, profile="self")
        self.assertFalse(out["block_adult"])  # back to the self default
        out = self.svc.update(a, block_adult=True)
        self.assertEqual((out["profile"], out["block_adult"]), ("self", True))

    def test_delete_removes_client_rules_and_access(self):
        a = self.svc.create("child")["client_id"]
        b = self.svc.create("child")["client_id"]
        self.svc.update(a, block_domains=["bad.example"])
        self.svc.delete(a)
        with self.assertRaises(NotFound):
            self.svc.get(a)
        self.assertEqual(self.ag.access_state["allowed_clients"], sorted([b, service_mod.ACCESS_SENTINEL]))
        self.assertFalse(any(a in r for r in self.ag.rules))

    def test_monitor_client_is_stable_and_hidden(self):
        first = self.svc.ensure_monitor_client()
        self.assertEqual(self.svc.ensure_monitor_client(), first)
        self.assertTrue(first.startswith("monitor-"))
        self.assertEqual(self.svc.list(), [])
        self.assertIn(first, self.ag.access_state["allowed_clients"])

    def test_not_found(self):
        for bad in ("nope1234", "../etc", ""):
            with self.assertRaises(NotFound):
                self.svc.get(bad)

    def stored(self, client_id):
        return self.ag._clients["pp-" + client_id]

    def test_default_categories(self):
        self.assertEqual(self.svc.create("child")["blocked_categories"], sorted(profiles.CATEGORIES))
        self.assertEqual(self.svc.create("self")["blocked_categories"], [])
        out = self.svc.create("self", True)
        self.assertEqual((out["blocked_categories"], out["block_adult"]), (["adult"], True))

    def test_create_with_categories_writes_services_and_tags(self):
        out = self.svc.create("self", blocked_categories=["gambling", "dating"])
        self.assertEqual((out["blocked_categories"], out["block_adult"]), (["dating", "gambling"], False))
        client = self.stored(out["client_id"])
        self.assertEqual(client["tags"], ["os_other"])
        self.assertEqual(client["blocked_services"], ["betway", "tinder"])
        self.assertFalse(client["safe_search"]["enabled"])

    def test_child_may_unblock_categories_but_not_the_bypass_protection(self):
        out = self.svc.create("child", blocked_categories=["social"])
        client = self.stored(out["client_id"])
        self.assertEqual(client["tags"], ["user_child"])  # no adult, no gambling list; bypass list and YouTube strict stay
        self.assertEqual(client["blocked_services"], ["icloud_private_relay", "instagram", "proton", "tiktok"])
        self.assertTrue(client["safe_search"]["enabled"])
        out = self.svc.create("child", block_adult=False)  # the old flag unblocks adult for a child too
        self.assertEqual(out["blocked_categories"], ["dating", "gambling", "games", "social", "video"])
        self.assertTrue(self.stored(out["client_id"])["safe_search"]["enabled"])

    def test_block_adult_is_an_alias_and_must_not_contradict(self):
        out = self.svc.create("self", True, blocked_categories=["adult", "social"])
        self.assertEqual(out["blocked_categories"], ["adult", "social"])
        for args in ((False, ["adult"]), (True, ["social"])):
            with self.assertRaises(ValueError, msg=args):
                self.svc.create("self", args[0], blocked_categories=args[1])
        with self.assertRaises(ValueError):
            self.svc.create("self", blocked_categories=["porn"])
        self.assertEqual(len(self.ag.clients()), 1)  # nothing written by the failed calls

    def test_update_replaces_the_set(self):
        a = self.svc.create("child")["client_id"]
        out = self.svc.update(a, blocked_categories=["social"])
        self.assertEqual((out["blocked_categories"], out["block_adult"]), (["social"], False))
        self.assertEqual(self.stored(a)["tags"], ["user_child"])
        self.assertEqual(self.svc.update(a, blocked_categories=[])["blocked_categories"], [])
        self.assertEqual(self.svc.update(a, block_adult=True)["blocked_categories"], ["adult"])
        self.assertEqual(self.svc.update(a, blocked_categories=["games"], block_adult=False)["blocked_categories"], ["games"])
        self.assertEqual(self.stored(a)["blocked_services"], ["icloud_private_relay", "proton", "steam"])
        with self.assertRaises(ValueError):
            self.svc.update(a, blocked_categories=["games"], block_adult=True)
        with self.assertRaises(ValueError):
            self.svc.update(a, blocked_categories=["porn"])
        self.assertEqual(self.svc.get(a)["blocked_categories"], ["games"])  # failed calls changed nothing
        out = self.svc.update(a, allow_domains=["x.example"])  # domains alone leave the categories alone
        self.assertEqual(out["blocked_categories"], ["games"])
        self.assertEqual(self.svc.update(a, profile="child")["blocked_categories"], ["games"])  # same profile again

    def test_a_new_profile_starts_from_its_own_defaults(self):
        a = self.svc.create("self", blocked_categories=["gambling"])["client_id"]
        self.assertEqual(self.svc.update(a, profile="child")["blocked_categories"], sorted(profiles.CATEGORIES))
        self.assertEqual(self.svc.update(a, profile="self")["blocked_categories"], [])
        self.assertEqual(self.svc.update(a, profile="child", blocked_categories=["social"])["blocked_categories"], ["social"])
        out = self.svc.update(a, profile="self", block_adult=True)
        self.assertEqual((out["profile"], out["blocked_categories"]), ("self", ["adult"]))
        self.assertEqual(self.stored(a)["tags"], ["device_other"])  # the child tag is gone with the profile

    def test_list_shows_categories(self):
        self.svc.create("self", blocked_categories=["video"], client_id="aaaa1111")
        self.svc.create("child", client_id="bbbb2222")
        listed = {c["client_id"]: c for c in self.svc.list()}
        self.assertEqual(listed["aaaa1111"]["blocked_categories"], ["video"])
        self.assertEqual(listed["bbbb2222"]["blocked_categories"], sorted(profiles.CATEGORIES))
        self.assertTrue(listed["bbbb2222"]["block_adult"])

    def test_catalogue_without_one_of_our_groups_fails_closed(self):
        self.ag.blocked_services_catalogue = lambda: [s for s in CATALOGUE if s["group_id"] != "gaming"]
        with self.assertRaises(AdGuardError):
            self.svc.create("child")
        self.assertEqual(self.ag.clients(), [])


class UpgradeFromFirstReleaseTest(unittest.TestCase):
    """Phones created before categories existed must keep their meaning (and the gambling list)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ag = FakeAdGuard()
        self.ag._clients["pp-childchild"] = legacy_client("childchild", ["user_child", "device_other"], LEGACY_CHILD_SERVICES)
        self.ag._clients["pp-selfplain"] = legacy_client("selfplain", [])
        self.ag._clients["pp-selfadult"] = legacy_client("selfadult", ["device_other"])
        self.svc = Service(self.ag, "dns.example.org", self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_old_phones_read_back_as_they_were(self):
        seen = {c["client_id"]: (c["profile"], c["blocked_categories"], c["block_adult"]) for c in self.svc.list()}
        self.assertEqual(
            seen,
            {
                "childchild": ("child", sorted(profiles.CATEGORIES), True),
                "selfplain": ("self", [], False),
                "selfadult": ("self", ["adult"], True),
            },
        )
        self.assertEqual(self.svc.get("childchild")["blocked_categories"], sorted(profiles.CATEGORIES))

    def test_upgrade_adds_only_the_gambling_tag_to_the_old_child(self):
        before = {n: dict(c) for n, c in self.ag._clients.items()}
        self.assertEqual(self.svc.upgrade_clients(), 1)
        child = self.ag._clients["pp-childchild"]
        self.assertEqual(child["tags"], ["device_other", "os_other", "user_child"])
        self.assertEqual(child["blocked_services"], LEGACY_CHILD_SERVICES)  # same services as before
        for name in ("pp-selfplain", "pp-selfadult"):
            self.assertEqual(self.ag._clients[name], before[name])
        self.assertEqual(self.svc.upgrade_clients(), 0)  # nothing left to do

    def test_a_child_that_unblocked_gambling_is_not_upgraded_back(self):
        out = self.svc.create("child", blocked_categories=["social", "adult", "dating", "games", "video"])
        self.assertNotIn("gambling", out["blocked_categories"])
        self.assertEqual(self.svc.upgrade_clients(), 1)  # only the old child
        self.assertNotIn("os_other", self.ag._clients["pp-" + out["client_id"]]["tags"])
        self.assertNotIn("gambling", self.svc.get(out["client_id"])["blocked_categories"])

    def test_changing_an_old_phone_keeps_what_it_blocked(self):
        out = self.svc.update("childchild", allow_domains=["ok.example"])
        self.assertEqual(out["blocked_categories"], sorted(profiles.CATEGORIES))
        self.assertIn("os_other", self.ag._clients["pp-childchild"]["tags"])  # rebuilt with the new tag
        out = self.svc.update("childchild", blocked_categories=["gambling", "adult"])
        self.assertEqual(out["blocked_categories"], ["adult", "gambling"])
        out = self.svc.update("selfadult", blocked_categories=["adult", "dating"])
        self.assertEqual(out["blocked_categories"], ["adult", "dating"])

    def test_list_refresh_upgrades_clients_restored_from_an_old_backup(self):
        from unittest import mock

        from ppdns.server import Jobs

        settings = ConfigTest().settings(self.tmp.name, PPDNS_LISTS_DIR=self.tmp.name)
        jobs = Jobs(settings, self.svc)
        with mock.patch.object(lists, "build", return_value={}):
            jobs.refresh_lists()
        self.assertEqual(self.ag.refreshed, 1)
        self.assertIn("os_other", self.ag._clients["pp-childchild"]["tags"])


class SigV4Test(unittest.TestCase):
    """Known answers from the AWS S3 Signature Version 4 examples (header-based auth)."""

    KEYS = ("AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY")

    def sign(self, query):
        import datetime as dt

        from ppdns.backup import sign_v4

        now = dt.datetime(2013, 5, 24, tzinfo=dt.timezone.utc)
        headers, _ = sign_v4("GET", "examplebucket.s3.amazonaws.com", "/", query, b"", "us-east-1", *self.KEYS, now)
        return headers["Authorization"].rsplit("Signature=", 1)[1]

    def test_aws_examples(self):
        self.assertEqual(self.sign({"lifecycle": ""}), "fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543")
        self.assertEqual(
            self.sign({"max-keys": "2", "prefix": "J"}), "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7"
        )

    def test_blank_region_falls_back(self):
        from ppdns.backup import s3_from_env

        s3, prefix = s3_from_env({
            "PPDNS_BACKUP_S3_BUCKET": "b", "PPDNS_BACKUP_S3_ENDPOINT": "https://s3.example",
            "PPDNS_BACKUP_S3_REGION": "", "PPDNS_BACKUP_S3_ACCESS_KEY": "a", "PPDNS_BACKUP_S3_SECRET_KEY": "s",
        })
        self.assertEqual((s3.region, prefix), ("us-east-1", "plainphone-dns/"))


class JobsTest(unittest.TestCase):
    def test_reused_lists_refresh_at_their_original_deadline(self):
        from unittest.mock import patch
        from ppdns.server import Jobs

        with tempfile.TemporaryDirectory() as tmp:
            settings = ConfigTest().settings(tmp, PPDNS_LISTS_DIR=tmp, PPDNS_LISTS_REFRESH_HOURS="12")
            interval = 12 * 3600
            sources = [s for s in lists.SOURCES if s.tag]
            lists.build(tmp, opener=lambda *_args, **_kwargs: io.BytesIO(b"example.org\n"))
            for i, source in enumerate(sources):
                path = lists.local_path(tmp, source)
                downloaded = 3600 if i == 0 else interval
                os.utime(path, (downloaded, downloaded))
            jobs = Jobs(settings, Service(FakeAdGuard(), settings.domain, tmp))
            with patch("ppdns.lists.time.time", return_value=interval), patch("ppdns.server._every") as every:
                jobs.start()
            delay = every.call_args_list[0].kwargs["delay"]
            with patch("ppdns.lists.time.time", return_value=interval):
                self.assertEqual(delay(), 3600)
            with patch("ppdns.lists.time.time", return_value=interval + 3601):
                self.assertEqual(delay(), 0)

            downloaded_urls = []

            def build(directory, **kwargs):
                def opener(request, **_):
                    downloaded_urls.append(request.full_url)
                    raise OSError("upstream unavailable")

                return original_build(directory, opener=opener, **kwargs)

            original_build = lists.build
            with patch("ppdns.lists.time.time", return_value=interval + 3601), patch.object(lists, "build", build):
                jobs.refresh_lists()
                self.assertEqual(downloaded_urls, [sources[0].url])
                self.assertEqual(delay(), interval - 3601)

    def test_reload_cert_only_when_the_file_changes_or_forced(self):
        from ppdns.server import Jobs

        with tempfile.TemporaryDirectory() as tmp:
            cert = os.path.join(tmp, "c.crt")
            with open(cert, "w") as fh:
                fh.write("x")
            settings = ConfigTest().settings(tmp, PPDNS_CERT_FILE=cert)
            ag = FakeAdGuard()
            sent = []
            ag.tls_status = lambda: {"enabled": True, "server_name": "dns.example.org", "certificate_path": cert,
                                     "private_key_path": "/k", "port_dns_over_tls": 853, "valid_cert": True}
            ag.tls_configure = lambda cfg: sent.append(cfg)
            jobs = Jobs(settings, Service(ag, settings.domain, tmp))
            jobs.reload_cert()
            self.assertEqual(sent, [])  # unchanged since start
            os.utime(cert, (time.time() + 60, time.time() + 60))
            jobs.reload_cert()
            self.assertEqual(len(sent), 1)
            self.assertEqual(sent[0]["certificate_path"], cert)
            self.assertNotIn("valid_cert", sent[0])
            jobs.reload_cert()
            self.assertEqual(len(sent), 1)
            jobs.reload_cert(force=True)
            self.assertEqual(len(sent), 2)

    def test_missing_filters_are_added_once(self):
        from ppdns.server import Jobs

        with tempfile.TemporaryDirectory() as tmp:
            settings = ConfigTest().settings(tmp, PPDNS_LISTS_DIR=tmp)
            ag = FakeAdGuard()
            jobs = Jobs(settings, Service(ag, settings.domain, tmp))
            added = jobs.ensure_filters()
            self.assertEqual(len(added), len(lists.wanted_filters(tmp)) - 1)  # OISD big was there
            self.assertEqual(jobs.ensure_filters(), [])
            with open(os.path.join(tmp, "plainphone-child-youtube-strict.txt")) as fh:
                text = fh.read()
            self.assertIn("|www.youtube.com^$dnsrewrite=NOERROR;CNAME;restrict.youtube.com,ctag=user_child", text)

    def test_reload_lists_at_start_never_stops_the_api(self):
        from ppdns.server import Jobs

        with tempfile.TemporaryDirectory() as tmp:
            settings = ConfigTest().settings(tmp, PPDNS_LISTS_DIR=tmp)
            ag = FakeAdGuard()
            jobs = Jobs(settings, Service(ag, settings.domain, tmp))
            self.assertTrue(jobs.reload_lists())
            self.assertEqual(ag.refreshed, 1)

            def broken():
                raise OSError("list download timed out")

            ag.refresh_filters = broken
            with self.assertLogs("ppdns", level="ERROR"):
                self.assertFalse(jobs.reload_lists())


class BackupTest(unittest.TestCase):
    def test_local_retention_and_s3_round_trip(self):
        from http.server import BaseHTTPRequestHandler

        from ppdns import backup

        store: dict[str, bytes] = {}

        class FakeS3(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _ok(self, body=b""):
                assert self.headers["Authorization"].startswith("AWS4-HMAC-SHA256 Credential=AK/")
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_PUT(self):
                store[self.path.split("?")[0]] = self.rfile.read(int(self.headers["Content-Length"]))
                self._ok()

            def do_GET(self):
                keys = "".join(f"<Key>{k.split('/', 2)[2]}</Key>" for k in sorted(store))
                self._ok(f'<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">{keys}</ListBucketResult>'.encode())

            def do_DELETE(self):
                store.pop(self.path, None)
                self._ok()

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), FakeS3)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        env = {
            "PPDNS_BACKUP_S3_ENDPOINT": f"http://127.0.0.1:{httpd.server_address[1]}",
            "PPDNS_BACKUP_S3_BUCKET": "bkt",
            "PPDNS_BACKUP_S3_ACCESS_KEY": "AK",
            "PPDNS_BACKUP_S3_SECRET_KEY": "SK",
        }
        try:
            with tempfile.TemporaryDirectory() as conf, tempfile.TemporaryDirectory() as data:
                with open(os.path.join(conf, "AdGuardHome.yaml"), "w") as fh:
                    fh.write("clients: {}\n")
                names = []
                for i in range(4):
                    name, blob = backup.make_archive(conf)
                    name = name.replace(".tar.gz", f"-{i}.tar.gz")  # same second in a fast test
                    backup.keep_local(os.path.join(data, "backups"), name, blob, keep=2)
                    names.append(name)
                self.assertEqual(sorted(os.listdir(os.path.join(data, "backups"))), names[2:])
                for _ in range(3):
                    backup.run(conf, data, keep=2, env=env)
                    time.sleep(1.1)
                self.assertEqual(len(store), 2)
                self.assertTrue(all(k.startswith("/bkt/plainphone-dns/adguard-conf-") for k in store))
                blob = next(iter(store.values()))
                with tarfile.open(fileobj=io.BytesIO(blob)) as tar:
                    self.assertEqual(tar.extractfile("AdGuardHome.yaml").read(), b"clients: {}\n")
        finally:
            httpd.shutdown()
            httpd.server_close()


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ag = FakeAdGuard()
        Api.service = Service(self.ag, "dns.example.org", self.tmp.name)
        Api.token = "secret-token"
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Api)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.tmp.cleanup()

    def call(self, method, path, body=None, token="secret-token"):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method)
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                raw = resp.read()
                return resp.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read() or b"null")

    def test_auth_required(self):
        self.assertEqual(self.call("GET", "/v1/clients", token=None)[0], 401)
        self.assertEqual(self.call("GET", "/v1/clients", token="wrong")[0], 401)
        self.assertEqual(self.call("GET", "/healthz", token=None), (200, {"adguard": True}))

    def test_crud(self):
        status, created = self.call("POST", "/v1/clients", {"profile": "child", "block_domains": ["bad.example"]})
        self.assertEqual(status, 201)
        self.assertEqual(created["block_domains"], ["bad.example"])
        cid = created["client_id"]
        self.assertEqual(self.call("GET", f"/v1/clients/{cid}")[1]["profile"], "child")
        self.assertEqual(len(self.call("GET", "/v1/clients")[1]["clients"]), 1)
        status, changed = self.call("PATCH", f"/v1/clients/{cid}", {"profile": "self", "block_adult": True})
        self.assertEqual((status, changed["profile"], changed["block_adult"]), (200, "self", True))
        self.assertEqual(self.call("DELETE", f"/v1/clients/{cid}"), (204, None))
        self.assertEqual(self.call("GET", f"/v1/clients/{cid}")[0], 404)

    def test_server_chosen_client_id(self):
        status, created = self.call("POST", "/v1/clients", {"client_id": "abcdefghij234567wxyz", "profile": "self"})
        self.assertEqual((status, created["client_id"]), (201, "abcdefghij234567wxyz"))
        self.assertEqual(self.call("POST", "/v1/clients", {"client_id": "abcdefghij234567wxyz", "profile": "child"})[0], 409)
        self.assertEqual(self.call("POST", "/v1/clients", {"client_id": "Bad.ID", "profile": "child"})[0], 400)
        self.assertEqual(self.call("POST", "/v1/clients", {"client_id": 7, "profile": "child"})[0], 400)
        self.assertEqual(self.call("POST", "/v1/clients", {"client_id": "monitor-abcd", "profile": "child"})[0], 400)
        self.assertEqual(self.call("DELETE", "/v1/clients/monitor-abcd")[0], 404)
        self.assertEqual(
            self.call("POST", "/v1/clients", {"profile": "child", "block_domains": ["x y"]})[0], 400
        )
        self.assertEqual(len(self.call("GET", "/v1/clients")[1]["clients"]), 1)

    def test_categories_over_the_api(self):
        status, created = self.call("POST", "/v1/clients", {"profile": "child"})
        self.assertEqual(status, 201)
        self.assertEqual(created["blocked_categories"], ["adult", "dating", "gambling", "games", "social", "video"])
        self.assertTrue(created["block_adult"])
        status, created = self.call("POST", "/v1/clients", {"profile": "self"})
        self.assertEqual((created["blocked_categories"], created["block_adult"]), ([], False))
        status, created = self.call(
            "POST", "/v1/clients", {"profile": "self", "blocked_categories": ["video", "adult", "video"]}
        )
        self.assertEqual((status, created["blocked_categories"], created["block_adult"]), (201, ["adult", "video"], True))
        cid = created["client_id"]
        self.assertEqual(self.call("GET", f"/v1/clients/{cid}")[1]["blocked_categories"], ["adult", "video"])
        listed = {c["client_id"]: c for c in self.call("GET", "/v1/clients")[1]["clients"]}
        self.assertEqual(listed[cid]["blocked_categories"], ["adult", "video"])
        # PATCH replaces the set; block_adult is an alias; null means "not given"
        status, out = self.call("PATCH", f"/v1/clients/{cid}", {"blocked_categories": ["gambling"]})
        self.assertEqual((status, out["blocked_categories"], out["block_adult"]), (200, ["gambling"], False))
        status, out = self.call("PATCH", f"/v1/clients/{cid}", {"block_adult": True})
        self.assertEqual((status, out["blocked_categories"]), (200, ["adult", "gambling"]))
        status, out = self.call("PATCH", f"/v1/clients/{cid}", {"blocked_categories": None, "block_adult": None})
        self.assertEqual((status, out["blocked_categories"]), (200, ["adult", "gambling"]))
        status, out = self.call("PATCH", f"/v1/clients/{cid}", {"blocked_categories": ["social"], "block_adult": False})
        self.assertEqual((status, out["blocked_categories"]), (200, ["social"]))
        status, out = self.call("PATCH", f"/v1/clients/{cid}", {"blocked_categories": []})
        self.assertEqual((status, out["blocked_categories"]), (200, []))

    def test_bad_categories_are_rejected_and_change_nothing(self):
        cid = self.call("POST", "/v1/clients", {"profile": "self", "blocked_categories": ["games"]})[1]["client_id"]
        for body in (
            {"blocked_categories": ["porn"]},
            {"blocked_categories": "games"},
            {"blocked_categories": [1]},
            {"blocked_categories": {"games": True}},
            {"blocked_categories": ["games"], "block_adult": True},  # contradiction
            {"blocked_categories": ["adult"], "block_adult": False},
        ):
            status, out = self.call("PATCH", f"/v1/clients/{cid}", body)
            self.assertEqual(status, 400, body)
            self.assertIn("error", out)
            status, out = self.call("POST", "/v1/clients", {"profile": "self", **body})
            self.assertEqual(status, 400, body)
        self.assertEqual(self.call("GET", f"/v1/clients/{cid}")[1]["blocked_categories"], ["games"])
        self.assertEqual(len(self.call("GET", "/v1/clients")[1]["clients"]), 1)  # no phone from the failed POSTs

    def test_bad_input(self):
        self.assertEqual(self.call("POST", "/v1/clients", {"profile": "teen"})[0], 400)
        self.assertEqual(self.call("POST", "/v1/clients", {"profile": "self", "block_adult": "yes"})[0], 400)
        self.assertEqual(self.call("POST", "/v1/clients", {"profile": "self", "allow_domains": "x.com"})[0], 400)
        self.assertEqual(self.call("PATCH", "/v1/clients/doesnotexist", {})[0], 404)
        self.assertEqual(self.call("GET", "/v1/nothing")[0], 404)


class ConfigTest(unittest.TestCase):
    def settings(self, conf_dir, **overrides):
        env = {
            "PPDNS_DOMAIN": "dns.example.org",
            "PPDNS_ADGUARD_PASSWORD": "pw",
            "PPDNS_ADGUARD_PASSWORD_HASH": "$2a$10$abcdefghijklmnopqrstuv",
            "PPDNS_API_TOKEN": "t",
            "PPDNS_CONF_DIR": conf_dir,
        }
        env.update(overrides)
        return config.Settings.from_env(env)

    def test_privacy_settings_in_first_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            s = self.settings(tmp)
            self.assertTrue(config.write_first_config(s))
            self.assertFalse(config.write_first_config(s))  # never overwritten
            with open(s.config_path) as fh:
                text = fh.read()
            self.assertEqual(oct(os.stat(s.config_path).st_mode & 0o777), "0o600")
        querylog = text.split("querylog:")[1].split("statistics:")[0]
        self.assertIn("enabled: false", querylog)
        self.assertIn("interval: 24h", querylog)
        self.assertIn("anonymize_client_ip: true", text)
        self.assertIn("port_https: 0", text)
        self.assertIn('server_name: "dns.example.org"', text)
        self.assertIn('certificate_path: "/certs/certificates/dns.example.org.crt"', text)
        for _name, url, filter_id in lists.wanted_filters(s.lists_dir):
            self.assertIn(f"url: {json.dumps(url)}\n", text)
            self.assertIn(f"id: {filter_id}\n", text)
        runtime = text.split("runtime_sources:")[1].split("persistent:")[0]
        self.assertNotIn("true", runtime)

    def test_password_hash_must_be_bcrypt(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(SystemExit):
                config.render_adguard_yaml(self.settings(tmp, PPDNS_ADGUARD_PASSWORD_HASH="plain"))


class DotWireTest(unittest.TestCase):
    def test_round_trip_with_compression(self):
        query = dot.encode_query("www.google.com", dot.TYPE_A, query_id=7)
        # response: header + question + CNAME (pointer to question) + A
        header = bytes.fromhex("0007 8180 0001 0002 0000 0000".replace(" ", ""))
        question = query[12:]
        cname_target = b"\x0fforcesafesearch\xc0\x10"  # "forcesafesearch" + pointer to "google.com"
        cname = b"\xc0\x0c" + bytes.fromhex("0005 0001 0000003c") + len(cname_target).to_bytes(2, "big") + cname_target
        a_rr = b"\xc0\x2c" + bytes.fromhex("0001 0001 0000003c 0004") + bytes([216, 239, 38, 120])
        answer = dot.decode_response(header + question + cname + a_rr)
        self.assertEqual(answer.rcode, "NOERROR")
        self.assertEqual(answer.cname, ["forcesafesearch.google.com"])
        self.assertEqual(answer.a, ["216.239.38.120"])
        self.assertFalse(answer.blocked)

    def test_blocked_detection(self):
        self.assertTrue(dot.Answer("NXDOMAIN", [], [], []).blocked)
        self.assertTrue(dot.Answer("NOERROR", ["0.0.0.0"], [], []).blocked)
        self.assertFalse(dot.Answer("NOERROR", ["93.184.215.14"], [], []).blocked)
        self.assertFalse(dot.Answer("NOERROR", [], [], []).blocked)


if __name__ == "__main__":
    unittest.main()
