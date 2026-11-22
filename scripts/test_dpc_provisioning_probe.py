# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Plainphone authors
"""Checks the DPC provisioning probe's decisions without an emulator (issue #255)."""
import hashlib
import importlib.util
import json
import tempfile
import unittest
import zlib
from pathlib import Path

import yaml

spec = importlib.util.spec_from_file_location("probe", Path(__file__).with_name("dpc-provisioning-probe.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

WORKFLOWS = Path(__file__).parents[1] / ".github/workflows"


def asset(name):
    return {"name": name, "url": f"https://api.example/{name}",
            "browser_download_url": f"https://example.org/download/{name}"}


def node(label, bounds="[0,0][100,50]", clickable=True, enabled=True):
    return (f'<node text="{label}" content-desc="" clickable="{str(clickable).lower()}" '
            f'enabled="{str(enabled).lower()}" package="com.google.android.setupwizard" bounds="{bounds}"/>')


def dump(*nodes):
    return ('UI hierchary dumped to: /data/local/tmp/ui.xml\n<?xml version="1.0" encoding="UTF-8"?>'
            f'<hierarchy rotation="0"><node text="" bounds="[0,0][1080,2400]">{"".join(nodes)}</node></hierarchy>')


class ReleaseTest(unittest.TestCase):
    def test_takes_the_newest_release_with_apk_and_metadata(self):
        releases = [
            {"tag_name": "v0.1.21", "draft": True, "assets": [asset("plainphone-0.1.21.apk"), asset("plainphone-0.1.21.apk.json")]},
            {"tag_name": "v0.1.20", "prerelease": True, "assets": [asset("plainphone-0.1.20.apk")]},
            {"tag_name": "v0.1.19", "prerelease": True,
             "assets": [asset("plainphone-0.1.19-android10.apk"), asset("plainphone-0.1.19.apk"), asset("plainphone-0.1.19.apk.json")]},
        ]
        release, apk, meta = probe.pick_release(releases)
        self.assertEqual((release["tag_name"], apk["name"], meta["name"]),
                         ("v0.1.19", "plainphone-0.1.19.apk", "plainphone-0.1.19.apk.json"))

    def test_a_pinned_tag_without_metadata_stops(self):
        releases = [{"tag_name": "v0.1.18", "assets": [asset("plainphone-0.1.18.apk")]}]
        with self.assertRaises(SystemExit):
            probe.pick_release(releases, "v0.1.18")

    def test_checks_sha256_and_version_against_the_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            apk = Path(tmp, "plainphone-0.1.20.apk")
            apk.write_bytes(b"apk bytes")
            digest = hashlib.sha256(b"apk bytes").hexdigest()
            self.assertEqual(probe.check_apk(apk, {"sha256": digest, "versionName": "0.1.20"}, "v0.1.20"), digest)
            with self.assertRaisesRegex(SystemExit, "mismatch"):
                probe.check_apk(apk, {"sha256": "0" * 64, "versionName": "0.1.20"}, "v0.1.20")
            with self.assertRaisesRegex(SystemExit, "versionName"):
                probe.check_apk(apk, {"sha256": digest, "versionName": "0.1.19"}, "v0.1.20")
            with self.assertRaisesRegex(SystemExit, "no sha256"):
                probe.check_apk(apk, {"versionName": "0.1.20"}, "v0.1.20")


class CameraFrameTest(unittest.TestCase):
    def test_draws_each_module_square_and_centred(self):
        ascii_qr = "##  ##\n  ##  \n##    \n"
        modules = probe.qr_modules(ascii_qr)
        self.assertEqual(modules, [[True, False, True], [False, True, False], [True, False, False]])
        png = probe.camera_frame(modules, width=40, height=30)
        width, height = int.from_bytes(png[16:20], "big"), int.from_bytes(png[20:24], "big")
        self.assertEqual((width, height), (40, 30))
        idat = png[png.index(b"IDAT") + 4:png.index(b"IEND") - 8]
        rows = [r[1:] for r in (lambda raw: [raw[i:i + 41] for i in range(0, len(raw), 41)])(zlib.decompress(idat))]
        scale = int(30 * 0.8) // 3  # 8 px per module
        left, top = (40 - 3 * scale) // 2, (30 - 3 * scale) // 2
        for my, line in enumerate(modules):
            for mx, dark in enumerate(line):
                pixel = rows[top + my * scale + scale // 2][left + mx * scale + scale // 2]
                self.assertEqual(pixel, 0 if dark else 255, (mx, my))
        self.assertEqual(rows[0][0], 255)


class ScreenTest(unittest.TestCase):
    def test_parses_labels_and_centres(self):
        nodes = probe.parse_ui(dump(node("Accept &amp; continue", "[100,2000][500,2100]")))
        button = next(n for n in nodes if n["label"])
        self.assertEqual((button["label"], button["center"]), ("Accept & continue", (300, 2050)))
        self.assertEqual(probe.parse_ui("ERROR: could not get idle state."), [])

    def test_classifies_play_protect_and_setup_errors(self):
        self.assertEqual(probe.classify(["App blocked to protect your device", "OK"]), "block")
        self.assertEqual(probe.classify(["Unsafe app blocked", "Play Protect"]), "block")
        self.assertEqual(probe.classify(["Play Protect", "This app can request access to sensitive data", "Install anyway"]),
                         "warning")
        self.assertEqual(probe.classify(["Can’t set up device", "Reset"]), "error")
        self.assertIsNone(probe.classify(["This device belongs to your organisation", "Next"]))

    def test_presses_what_a_parent_presses_and_never_cancel(self):
        def pick(*labels):
            chosen = probe.choose_tap(probe.parse_ui(dump(*(node(label) for label in labels))))
            return chosen and chosen["label"]
        self.assertEqual(pick("Cancel", "Accept &amp; continue"), "Accept & continue")
        self.assertEqual(pick("Uninstall", "Install anyway"), "Install anyway")
        self.assertEqual(pick("Send", "Don’t send"), "Don’t send")
        self.assertEqual(pick("Cancel", "Stop setup"), None)
        self.assertEqual(pick("Emergency call", "Get started"), None)
        self.assertEqual(pick("AndroidWifi", "See all Wi-Fi networks"), "AndroidWifi")
        # Body text that happens to contain a button word is not a button.
        self.assertEqual(pick("By continuing you accept that your organisation can see this device's data"), None)
        disabled = probe.parse_ui(dump(node("Next", enabled=False)))
        self.assertIsNone(probe.choose_tap(disabled))

    def test_six_taps_land_outside_every_button(self):
        nodes = probe.parse_ui(dump(node("Get started", "[0,780][1080,900]"), node("", "[0,1100][1080,1300]")))
        spots = probe.empty_spots(nodes, 1080, 2400)
        self.assertNotIn((540, 840), spots)
        self.assertNotIn((540, 1200), spots)
        self.assertEqual(spots[0], (540, 528))

    def test_reads_device_owner_from_dpm(self):
        self.assertTrue(probe.owners_include_plainphone(
            "1 owner:\nUser  0: admin=org.plainphone.app/.PlainphoneAdminReceiver,DeviceOwner\n"))
        self.assertFalse(probe.owners_include_plainphone("no owners\n"))
        self.assertFalse(probe.owners_include_plainphone("User 10: admin=org.plainphone.app/.X,Profile Owner\n"))


class ConclusionTest(unittest.TestCase):
    def test_only_a_real_answer_passes(self):
        cases = [
            ({"device_owner": True}, "provisioned"),
            ({"device_owner": "inferred"}, "provisioned"),
            ({"device_owner": True, "play_protect": "warning"}, "provisioned_after_warning"),
            ({"device_owner": False, "play_protect": "block"}, "blocked_by_play_protect"),
            ({"device_owner": False, "error_screen": "Can't set up device"}, "inconclusive"),
            ({"device_owner": True, "play_protect": "block"}, "inconclusive"),
            ({"device_owner": False}, "inconclusive"),
            ({"device_owner": True, "inconclusive": "no setup wizard"}, "inconclusive"),
        ]
        for obs, expected in cases:
            with self.subTest(obs=obs):
                self.assertEqual(probe.conclude(obs)["conclusion"], expected)
        self.assertIn("inferred", probe.conclude({"device_owner": "inferred"})["reason"])
        self.assertEqual(probe.CONCLUSIVE, {"provisioned", "provisioned_after_warning", "blocked_by_play_protect"})


class WorkflowTest(unittest.TestCase):
    def test_probe_runs_only_on_manual_dispatch(self):
        probe_workflow = yaml.safe_load((WORKFLOWS / "dpc-provisioning-probe.yml").read_text(encoding="utf-8"))
        # PyYAML reads the `on:` key as True.
        triggers = probe_workflow[True]
        self.assertEqual(set(triggers), {"workflow_dispatch", "workflow_call"})
        ci = yaml.safe_load((WORKFLOWS / "ci.yml").read_text(encoding="utf-8"))
        caller = ci["jobs"]["dpc-provisioning-probe"]
        self.assertEqual(caller["uses"], "./.github/workflows/dpc-provisioning-probe.yml")
        self.assertIn("github.event_name == 'workflow_dispatch'", caller["if"])
        self.assertIn("inputs.dpc_probe", caller["if"])
        self.assertIs(ci[True]["workflow_dispatch"]["inputs"]["dpc_probe"]["default"], False)

    def test_probe_job_uses_a_play_image_and_always_uploads(self):
        job = yaml.safe_load((WORKFLOWS / "dpc-provisioning-probe.yml").read_text(encoding="utf-8"))["jobs"]["probe"]
        text = json.dumps(job)
        self.assertIn("google_apis_playstore", text)
        self.assertIn("dpc-provisioning-probe.py fetch", text)
        self.assertIn("dpc-provisioning-probe.py run", text)
        upload = next(s for s in job["steps"] if s.get("uses", "").startswith("actions/upload-artifact@"))
        self.assertEqual(upload["if"], "always()")


if __name__ == "__main__":
    unittest.main()
