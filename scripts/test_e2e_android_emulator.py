# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Plainphone authors
"""Checks the emulator harness's serial-console protocol without an emulator."""
import importlib.util
import re
import socket
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

spec = importlib.util.spec_from_file_location("harness", Path(__file__).with_name("e2e-android-emulator.py"))
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)

# What adb's server writes when it mistakes a socket for an emulator (run 45001557220).
ADB_CNXN = b"CNXN\x00\x00\x00\x01\x00\x10\x00\x00host::features=shell_v2,cmd,fixed_push_mkdir,apex,abb\n"


class FakeConsole:
    """The guest end of the serial socket: echoes input like a TTY and answers with `reply`."""

    def __init__(self, reply, ignore=0):
        self.harness, self.guest = socket.socketpair()
        self.reply = reply
        self.ignore = ignore
        self.commands = []
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def serve(self):
        with self.guest, self.guest.makefile("rb") as stream:
            for line in stream:
                self.commands.append(line)
                if len(self.commands) <= self.ignore:
                    continue  # The console service has not started yet.
                marker = re.search(rb"'(plainphone-[0-9a-f]+)-start'", line)[1]
                self.guest.sendall(line.replace(b"\n", b"\r\n") + self.reply(marker))

    def close(self):
        self.harness.close()
        self.thread.join(timeout=5)


def answer(output, status=b"0"):
    return lambda marker: b"\r\n" + marker + b"-start\r\n" + output + b"\r\n" + marker + b"-end " + status + b"\r\n"


class SerialPortTest(unittest.TestCase):
    def test_default_port_is_outside_adb_scan_range(self):
        self.assertEqual(harness.serial_port({}), harness.DEFAULT_SERIAL_PORT)
        self.assertNotIn(harness.DEFAULT_SERIAL_PORT, harness.ADB_SCAN_PORTS)

    def test_rejects_adb_emulator_ports(self):
        for port in ("5555", "5557", "5585"):
            with self.subTest(port=port), self.assertRaisesRegex(RuntimeError, "adb's emulator scan range"):
                harness.serial_port({"E2E_SERIAL_PORT": port})


class SerialShellTest(unittest.TestCase):
    def run_command(self, console, *args, timeout=5):
        self.addCleanup(console.close)
        return harness.serial_shell(console.harness, *args, timeout=timeout)

    def test_returns_output_between_markers(self):
        console = FakeConsole(answer(b"Success: Device owner set"))
        self.assertEqual(self.run_command(console, "dpm", "set-device-owner", "x/.Y"),
                         "Success: Device owner set\n")
        self.assertIn(b"dpm set-device-owner x/.Y </dev/null", console.commands[0])

    def test_raises_on_nonzero_status(self):
        with self.assertRaisesRegex(RuntimeError, r"failed: su \(1\)\nnot allowed"):
            self.run_command(FakeConsole(answer(b"not allowed", b"1")), "su", "0", "true")

    def test_rejects_adb_handshake_on_the_console(self):
        # The CI failure: adb's CNXN bytes were echoed into the end marker's line.
        reply = lambda marker: answer(b"", b"0" + ADB_CNXN.rstrip(b"\n"))(marker)
        with self.assertRaisesRegex(RuntimeError, "adb is connected to the serial console"):
            self.run_command(FakeConsole(reply), "su", "0", "true")

    def test_accepts_cnxn_inside_command_output(self):
        # A base64 screenshot or an adbd logcat line can contain "CNXN" by chance.
        output = b"iVBORw0KGgoCNXNAAAA\r\nadbd: CNXN from host"
        self.assertEqual(self.run_command(FakeConsole(answer(output)), "logcat", "-d"),
                         "iVBORw0KGgoCNXNAAAA\nadbd: CNXN from host\n")

    def test_rejects_non_numeric_status(self):
        with self.assertRaisesRegex(RuntimeError, "Unexpected data"):
            self.run_command(FakeConsole(answer(b"", b"0push_mkdir")), "true")

    def test_reports_a_closed_console(self):
        ours, guest = socket.socketpair()
        self.addCleanup(ours.close)
        self.addCleanup(guest.close)
        guest.shutdown(socket.SHUT_WR)
        with self.assertRaisesRegex(RuntimeError, "disconnected"):
            harness.serial_shell(ours, "true", timeout=5)


class ProbeConsoleTest(unittest.TestCase):
    def test_resends_until_the_shell_answers(self):
        console = FakeConsole(answer(b""), ignore=2)
        self.addCleanup(console.close)
        harness.probe_console(console.harness, attempts=3, timeout=0.2)
        self.assertEqual(len(console.commands), 3)

    def test_gives_up_when_nothing_answers(self):
        console = FakeConsole(answer(b""), ignore=10)
        self.addCleanup(console.close)
        with self.assertRaisesRegex(RuntimeError, "No shell answered"):
            harness.probe_console(console.harness, attempts=2, timeout=0.2)


class DiagnosticsTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.artifacts = Path(temp.name)
        patch = mock.patch.object(harness, "ARTIFACTS", self.artifacts)
        patch.start()
        self.addCleanup(patch.stop)

    def test_falls_back_to_the_serial_console_when_adb_is_disabled(self):
        # The Device Owner lock turns off adb, which is when a failed sync needs these dumps.
        console = FakeConsole(answer(b"NetworkAgentInfo{... VALIDATED ...}"))
        self.addCleanup(console.close)
        refused = subprocess.CalledProcessError(1, "adb")
        with mock.patch.object(harness, "adb", side_effect=refused):
            harness.collect_diagnostics(console.harness, settle=0)
        self.assertEqual((self.artifacts / "connectivity.txt").read_text(), "NetworkAgentInfo{... VALIDATED ...}\n")
        self.assertTrue((self.artifacts / "jobscheduler.txt").exists())
        sent = b"".join(console.commands)
        self.assertIn(b"dumpsys connectivity", sent)
        self.assertIn(b"dumpsys jobscheduler org.plainphone.app", sent)
        self.assertIn(b"cmd activity broadcast -a androidx.work.diagnostics.REQUEST_DIAGNOSTICS -p org.plainphone.app", sent)

    def test_uses_adb_while_it_works(self):
        result = subprocess.CompletedProcess(("adb",), 0, stdout="jobs\n")
        with mock.patch.object(harness, "adb", return_value=result) as adb:
            harness.collect_diagnostics(None, settle=0)
        self.assertEqual((self.artifacts / "jobscheduler.txt").read_text(), "jobs\n")
        self.assertEqual([call.args[1:] for call in adb.call_args_list],
                         [*harness.DIAGNOSTICS.values(), harness.WORK_DIAGNOSTICS])

    def test_a_dead_console_does_not_hide_the_original_failure(self):
        ours, guest = socket.socketpair()
        self.addCleanup(ours.close)
        guest.close()
        with mock.patch.object(harness, "adb", side_effect=subprocess.CalledProcessError(1, "adb")):
            harness.collect_diagnostics(ours, settle=0)
        self.assertFalse((self.artifacts / "connectivity.txt").exists())


if __name__ == "__main__":
    unittest.main()
