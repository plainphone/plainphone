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
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ppdns import config, dot, lists, profiles  # noqa: E402
from ppdns.server import Api  # noqa: E402
from ppdns import service as service_mod  # noqa: E402
from ppdns.service import NotFound, Service  # noqa: E402

CATALOGUE = [
    {"id": "instagram", "group_id": "social_network"},
    {"id": "tiktok", "group_id": "social_network"},
    {"id": "steam", "group_id": "gaming"},
    {"id": "betway", "group_id": "gambling"},
    {"id": "tinder", "group_id": "dating"},
    {"id": "proton", "group_id": "privacy"},
    {"id": "youtube", "group_id": "streaming"},
    {"id": "twitch", "group_id": "streaming"},
    {"id": "spotify", "group_id": "streaming"},
    {"id": "whatsapp", "group_id": "messenger"},
]


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
        self._clients[client["name"]] = dict(client)

    def update_client(self, name, client):
        del self._clients[name]
        self._clients[client["name"]] = dict(client)

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

    def test_global_lists_are_urls_and_tagged_lists_are_local_files(self):
        for source in lists.SOURCES:
            url = lists.filter_url("/w/userfilters", source)
            self.assertEqual(url.startswith("/w/userfilters/"), source.tag is not None)


class ProfilesTest(unittest.TestCase):
    def test_child_profile(self):
        payload = profiles.client_payload("abcd1234", "child", False, CATALOGUE)
        self.assertEqual(payload["name"], "pp-abcd1234")
        self.assertEqual(payload["ids"], ["abcd1234"])
        self.assertEqual(payload["tags"], [lists.TAG_CHILD, lists.TAG_ADULT])  # adult cannot be turned off
        self.assertTrue(payload["safe_search"]["enabled"] and payload["safe_search"]["youtube"])
        self.assertEqual(
            payload["blocked_services"],
            ["betway", "instagram", "proton", "steam", "tiktok", "tinder", "twitch"],
        )
        self.assertFalse(payload["use_global_settings"])
        self.assertTrue(payload["ignore_querylog"])

    def test_self_profile(self):
        payload = profiles.client_payload("abcd1234", "self", False, CATALOGUE)
        self.assertEqual(payload["tags"], [])
        self.assertFalse(payload["safe_search"]["enabled"])
        self.assertEqual(payload["blocked_services"], [])
        adult = profiles.client_payload("abcd1234", "self", True, CATALOGUE)
        self.assertEqual(adult["tags"], [lists.TAG_ADULT])
        self.assertTrue(adult["safe_search"]["enabled"])

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
