# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Plainphone authors
"""End-to-end tests against a running stack, over real DNS-over-TLS.

Needs these environment variables (tests are skipped without them):

  PPDNS_TEST_SERVER   host or IP that serves DoT on port 853
  PPDNS_TEST_DOMAIN   the DoT base domain (ClientIDs go in front of it)
  PPDNS_TEST_API      ppdns API base URL, e.g. http://127.0.0.1:8053
  PPDNS_API_TOKEN     bearer token for the API
  PPDNS_TEST_VERIFY   "1" to verify the certificate (production), default off

Run: python3 -m unittest discover -s dns/tests -p 'test_e2e.py' -v
"""

from __future__ import annotations

import json
import os
import sys
import time
import unittest
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ppdns import dot  # noqa: E402

SERVER = os.environ.get("PPDNS_TEST_SERVER", "")
DOMAIN = os.environ.get("PPDNS_TEST_DOMAIN", "")
API = os.environ.get("PPDNS_TEST_API", "").rstrip("/")
TOKEN = os.environ.get("PPDNS_API_TOKEN", "")
VERIFY = os.environ.get("PPDNS_TEST_VERIFY") == "1"

# Google and YouTube answer these addresses for their SafeSearch / Restricted hosts.
GOOGLE_SAFE = "forcesafesearch.google.com"
YOUTUBE_STRICT = "restrict.youtube.com"
SAFE_IPS = {"216.239.38.120", "216.239.38.119"}


def api(method: str, path: str, body=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(API + path, data=data, method=method)
    request.add_header("Authorization", f"Bearer {TOKEN}")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
        return response.status, (json.loads(raw) if raw else None)


def ask(client_id: str, name: str, qtype: int = dot.TYPE_A) -> dot.Answer:
    last = None
    for _ in range(3):  # tolerate a slow upstream on a cold cache
        try:
            return dot.query(name, server=SERVER, tls_name=f"{client_id}.{DOMAIN}", qtype=qtype, verify=VERIFY)
        except (TimeoutError, ConnectionError, OSError) as exc:
            last = exc
            time.sleep(2)
    raise last


def eventually(check, timeout: float = 60.0) -> bool:
    """Domain rules are applied when AdGuard has rebuilt its filter engine (a few seconds)."""
    deadline = time.time() + timeout
    while True:
        if check():
            return True
        if time.time() > deadline:
            return False
        time.sleep(1)


def resolves(answer: dot.Answer) -> bool:
    return answer.rcode == "NOERROR" and bool(answer.a or answer.aaaa or answer.cname) and not answer.blocked


@unittest.skipUnless(SERVER and DOMAIN and API and TOKEN, "set PPDNS_TEST_* to run against a stack")
class EndToEnd(unittest.TestCase):
    created: list[str] = []

    @classmethod
    def setUpClass(cls):
        cls.child = cls._create({"profile": "child"})
        cls.selfp = cls._create({"profile": "self"})
        cls.self_adult = cls._create({"profile": "self", "block_adult": True})

    @classmethod
    def tearDownClass(cls):
        for client_id in cls.created:
            api("DELETE", f"/v1/clients/{client_id}")

    @classmethod
    def _create(cls, body):
        status, out = api("POST", "/v1/clients", body)
        assert status == 201, (status, out)
        cls.created.append(out["client_id"])
        assert out["hostname"] == f"{out['client_id']}.{DOMAIN}"
        return out["client_id"]

    # everyone ---------------------------------------------------------------
    def test_allowed_domain_resolves_for_every_profile(self):
        for client in (self.child, self.selfp, self.self_adult):
            self.assertTrue(resolves(ask(client, "example.com")), client)

    def test_ads_and_tracking_blocked_for_every_profile(self):
        for client in (self.child, self.selfp):
            self.assertTrue(ask(client, "googlesyndication.com").blocked, client)

    def test_encrypted_dns_endpoints_blocked_for_every_profile(self):
        for client in (self.child, self.selfp):
            self.assertTrue(ask(client, "dns.google").blocked, client)
            self.assertTrue(ask(client, "mozilla.cloudflare-dns.com").blocked, client)

    def test_unknown_client_id_is_refused(self):
        try:
            answer = ask("not-a-registered-phone-0000", "example.com")
        except (TimeoutError, ConnectionError, OSError):
            return  # AdGuard may drop the connection instead of answering
        self.assertFalse(resolves(answer), answer)

    # child vs self ----------------------------------------------------------
    def test_adult_content_blocked_for_child_not_for_self(self):
        self.assertTrue(ask(self.child, "pornhub.com").blocked)
        self.assertTrue(resolves(ask(self.selfp, "pornhub.com")))
        self.assertTrue(ask(self.self_adult, "pornhub.com").blocked)

    def test_social_media_blocked_for_child_not_for_self(self):
        for domain in ("instagram.com", "www.tiktok.com", "snapchat.com"):
            self.assertTrue(ask(self.child, domain).blocked, domain)
            self.assertTrue(resolves(ask(self.selfp, domain)), domain)

    def test_google_safesearch_for_child_and_self_adult_only(self):
        for client in (self.child, self.self_adult):
            answer = ask(client, "www.google.com")
            self.assertTrue(GOOGLE_SAFE in answer.cname or SAFE_IPS & set(answer.a), (client, answer))
        plain = ask(self.selfp, "www.google.com")
        self.assertFalse(GOOGLE_SAFE in plain.cname or SAFE_IPS & set(plain.a), plain)

    def test_youtube_restricted_for_child(self):
        for host in ("www.youtube.com", "m.youtube.com", "youtubei.googleapis.com"):
            answer = ask(self.child, host)
            self.assertIn(YOUTUBE_STRICT, answer.cname, (host, answer))  # strict, not restrictmoderate
        moderate = ask(self.self_adult, "www.youtube.com")
        self.assertTrue(any(c.startswith("restrict") for c in moderate.cname), moderate)
        plain = ask(self.selfp, "www.youtube.com")
        self.assertFalse(YOUTUBE_STRICT in plain.cname, plain)

    # per-phone changes ------------------------------------------------------
    def test_per_phone_allow_and_block(self):
        client = self._create({"profile": "self"})
        status, out = api(
            "PATCH",
            f"/v1/clients/{client}",
            {"block_domains": ["example.org"], "allow_domains": ["googlesyndication.com"]},
        )
        self.assertEqual(status, 200)
        self.assertEqual(out["block_domains"], ["example.org"])
        self.assertTrue(eventually(lambda: ask(client, "example.org").blocked))
        self.assertTrue(eventually(lambda: resolves(ask(client, "googlesyndication.com"))))
        # other phones are not affected
        self.assertTrue(resolves(ask(self.selfp, "example.org")))
        self.assertTrue(ask(self.selfp, "googlesyndication.com").blocked)

    def test_allowed_domain_beats_blocked_service_for_child(self):
        client = self._create({"profile": "child", "allow_domains": ["instagram.com"]})
        self.assertTrue(eventually(lambda: resolves(ask(client, "www.instagram.com"))))
        self.assertTrue(ask(client, "tiktok.com").blocked)

    def test_profile_change_takes_effect(self):
        client = self._create({"profile": "self"})
        self.assertTrue(resolves(ask(client, "instagram.com")))
        status, out = api("PATCH", f"/v1/clients/{client}", {"profile": "child"})
        self.assertEqual((status, out["profile"], out["block_adult"]), (200, "child", True))
        self.assertTrue(ask(client, "instagram.com").blocked)

    def test_deleted_client_stops_resolving(self):
        client = self._create({"profile": "child"})
        self.assertTrue(resolves(ask(client, "example.com")))
        api("DELETE", f"/v1/clients/{client}")
        self.created.remove(client)
        try:
            answer = ask(client, "example.com")
        except (TimeoutError, ConnectionError, OSError):
            return
        self.assertFalse(resolves(answer), answer)


if __name__ == "__main__":
    unittest.main()
