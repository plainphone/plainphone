# SPDX-License-Identifier: Apache-2.0
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("pick_simulator", Path(__file__).with_name("pick-simulator.py"))
pick_simulator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pick_simulator)

RUNTIME = "com.apple.CoreSimulator.SimRuntime.iOS-{}"


def device(name, udid, available=True):
    return {"name": name, "udid": udid, "isAvailable": available}


class PickSimulatorTests(unittest.TestCase):
    def test_newest_ios_26_iphone(self):
        listing = {"devices": {
            RUNTIME.format("18-5"): [device("iPhone 16", "old")],
            RUNTIME.format("26-0"): [device("iPhone 17", "a")],
            RUNTIME.format("26-1"): [device("iPhone 17 Pro Max", "b"), device("iPhone 17", "c"), device("iPad Air", "d")],
            "com.apple.CoreSimulator.SimRuntime.watchOS-26-1": [device("Apple Watch", "w")],
        }}
        self.assertEqual(pick_simulator.pick(listing), "platform=iOS Simulator,id=c")

    def test_skips_unavailable_and_older_runtimes(self):
        listing = {"devices": {
            RUNTIME.format("18-5"): [device("iPhone 16", "old")],
            RUNTIME.format("26-1"): [device("iPhone 17", "gone", available=False)],
        }}
        self.assertIsNone(pick_simulator.pick(listing))


if __name__ == "__main__":
    unittest.main()
