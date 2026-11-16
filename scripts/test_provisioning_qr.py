# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Plainphone authors
"""Checks that the QR script and the app agree on the PIN hash and the QR keys."""
import argparse
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("qr", Path(__file__).with_name("provisioning-qr.py"))
qr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qr)


class ProvisioningQrTest(unittest.TestCase):
    def test_pin_hash_matches_app_test_vector(self):
        # Same vector as MaintenancePinTest.kt
        self.assertEqual(
            qr.pin_hash("123456", "00112233445566778899aabbccddeeff"),
            "99b17387ba3d03187c4246371f9763757d6d27c0587d564fcbe5a5e326a94ac5",
        )

    def test_payload_has_required_provisioning_keys(self):
        args = argparse.Namespace(
            apk_url="https://example.org/a.apk", dns_host="family.adguard-dns.com", relock_minutes=30,
            allow=["com.spotify.music"], frp_account=[], wifi_ssid="Home", wifi_password="pw",
            wifi_security="WPA", wifi_hidden=False, country_code="+45",
            contact=["Mum=+45 12 34 56 78", "Gran; Ole=87654321"],
        )
        p = qr.build_payload(args, "abc", "1234")
        pre = "android.app.extra."
        self.assertEqual(p[pre + "PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME"], "org.plainphone.app/.PlainphoneAdminReceiver")
        self.assertEqual(p[pre + "PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM"], "abc")
        self.assertTrue(p[pre + "PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED"])
        extras = p[pre + "PROVISIONING_ADMIN_EXTRAS_BUNDLE"]
        self.assertNotIn("1234", extras.values(), "the PIN itself must never be in the QR code")
        self.assertEqual(extras["plainphone.allowed_packages"], "com.spotify.music")
        self.assertEqual(p[pre + "PROVISIONING_WIFI_SSID"], "Home")
        self.assertEqual(extras["plainphone.country_code"], "45")
        # Same format as ContactCodec.kt; separators in names are neutralised.
        self.assertEqual(extras["plainphone.contacts"], "Mum=+45 12 34 56 78;Gran Ole=87654321")
        # Phase 4: without --server-url the phone pairs with the hosted service.
        self.assertEqual(extras["plainphone.server_url"], "https://app.plainphone.org")

    def test_server_url_must_be_https(self):
        self.assertEqual(qr.check_server_url("https://pp.example.org/"), "https://pp.example.org")
        self.assertEqual(qr.check_server_url("https://pp.example.org:8443/x"), "https://pp.example.org:8443/x")
        for bad in ["http://pp.example.org", "https://u:p@pp.example.org", "https://pp.example.org/?a=1", "pp.example.org"]:
            with self.assertRaises(ValueError, msg=bad):
                qr.check_server_url(bad)

    def test_dns_host_template_gets_a_client_id(self):
        host, cid = qr.resolve_dns_host(qr.PLAINPHONE_DNS_TEMPLATE, None)
        self.assertRegex(cid, r"^[a-z0-9]{20}$")
        self.assertEqual(host, f"{cid}.dns.plainphone.org")
        host, cid = qr.resolve_dns_host("{id}.dns.example.org", "kid-1")
        self.assertEqual((host, cid), ("kid-1.dns.example.org", "kid-1"))

    def test_plain_dns_host_is_kept(self):
        self.assertEqual(qr.resolve_dns_host(qr.DEFAULT_DNS_HOST, None), ("family.adguard-dns.com", None))

    def test_bad_dns_values_are_refused(self):
        for template, cid in [("{id}.dns.plainphone.org", "Bad_ID"), ("{id}.dns.plainphone.org", "ab"),
                              ("family.adguard-dns.com", "kid-1"), ("not a host", None)]:
            with self.assertRaises(ValueError):
                qr.resolve_dns_host(template, cid)

    def test_bad_contacts_are_refused(self):
        for bad in ["Mum", "Mum=call me", "=", "Mum=+45 12 34 56 78; rm"]:
            with self.assertRaises(ValueError):
                qr.contacts_extra([bad])


if __name__ == "__main__":
    unittest.main()
