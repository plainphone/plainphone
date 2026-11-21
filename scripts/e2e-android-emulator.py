#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Run the emulator suite against a disposable Plainphone test server."""
import base64
import json
import os
from pathlib import Path
import re
import shlex
import socket
import subprocess
import tempfile
import time
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path(os.environ.get("E2E_ARTIFACTS", ROOT / "android/build/emulator-e2e"))
PACKAGE = "org.plainphone.app"
PARENT_NUMBER = "+12025550123"
REPLY = "Emulator parent reply"


def adb(*args, **kwargs):
    return subprocess.run(("adb", *args), timeout=kwargs.pop("timeout", 30), check=True, **kwargs)


def shell(*args):
    return adb("shell", *args, text=True, stdout=subprocess.PIPE).stdout


def serial_shell(console, *args, timeout=30):
    # The Device Owner disables adb as part of the real lock. The disposable
    # emulator's separate root console remains available to the test harness.
    marker = f"plainphone-{uuid4().hex}"
    command = shlex.join(args)
    console.settimeout(timeout)
    # Android services cannot use a serial TTY passed through Binder.
    console.sendall(f"set -o pipefail; printf '\\n%s\\n' '{marker}-start'; "
                    f"{command} </dev/null 2>&1 | cat; printf '\\n%s %s\\n' '{marker}-end' \"$?\"\n".encode())
    output = bytearray()
    start = f"{marker}-start".encode()
    end = f"{marker}-end ".encode()
    started = False
    with console.makefile("rb") as stream:
        for line in stream:
            content = line.rstrip(b"\r\n")
            if content == start:
                started = True
            elif started and content.startswith(end):
                result = output.decode(errors="replace").replace("\r\n", "\n")
                status = content[len(end):].decode()
                if status != "0":
                    raise RuntimeError(f"Emulator serial command failed: {args[0]} ({status})\n{result}")
                return result
            elif started:
                output.extend(line)
    raise RuntimeError("Emulator serial console disconnected")


def instrument(flow, port, token, console=None):
    command = (
        "am", "instrument", "-w", "-r", "-e", "class",
        f"{PACKAGE}.e2e.{flow}", "-e", "port", str(port), "-e", "parentToken",
        token, f"{PACKAGE}.test/androidx.test.runner.AndroidJUnitRunner",
    )
    if console is None:
        result = adb("shell", *command, text=True, stdout=subprocess.PIPE,
                     stderr=subprocess.STDOUT, timeout=240).stdout
    else:
        # The boot console starts before Android switches to the APEX mount
        # namespace. am instrument needs the libraries from the running system.
        result = serial_shell(
            console, "sh", "-c", 'exec su 0 nsenter -t "$(pidof system_server)" -m -- "$@"',
            "sh", *command, timeout=240,
        )
    (ARTIFACTS / f"{flow}.txt").write_text(result, encoding="utf-8")
    print(result, flush=True)
    # am instrument can exit zero even when a test fails or never ran.
    if not re.search(r"^OK \(1 test\)\s*$", result, re.MULTILINE) or "INSTRUMENTATION_FAILED" in result:
        raise RuntimeError(f"{flow} did not pass its one test")


def capture(console, label):
    try:
        with (ARTIFACTS / label).open("wb") as out:
            command = ("exec-out", "screencap", "-p") if label.endswith(".png") else ("logcat", "-d", "-v", "threadtime")
            try:
                adb(*command, stdout=out, stderr=subprocess.DEVNULL, timeout=10)
                return
            except (OSError, subprocess.SubprocessError):
                out.seek(0)
                out.truncate()
            if label.endswith(".png"):
                result = serial_shell(console, "sh", "-c", "screencap -p | base64", timeout=15)
                out.write(base64.b64decode(result))
            else:
                out.write(serial_shell(console, "logcat", "-d", "-v", "threadtime", timeout=15).encode())
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as exc:
        print(f"Unable to collect {label}: {exc}", flush=True)


def run_flows(port, token, console):
    if shell("getprop", "ro.kernel.qemu").strip() != "1":
        raise RuntimeError("Select a disposable Android emulator")
    android = ROOT / "android"
    adb("install", "-g", str(android / "app/build/outputs/apk/debug/app-debug.apk"))
    adb("install", str(android / "app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"))
    adb("install", str(android / "e2e-fixture/build/outputs/apk/debug/e2e-fixture-debug.apk"))
    shell("input", "keyevent", "KEYCODE_WAKEUP")
    shell("wm", "dismiss-keyguard")
    shell("svc", "power", "stayon", "true")
    for setting in ("window_animation_scale", "transition_animation_scale", "animator_duration_scale"):
        shell("settings", "put", "global", setting, "0")
    shell("settings", "put", "global", "auto_time", "0")
    shell("settings", "put", "global", "private_dns_mode", "off")
    instrument("LightModeFlow", port, token)

    shell("settings", "delete", "secure", "enabled_accessibility_services")
    shell("settings", "put", "secure", "accessibility_enabled", "0")
    if "Success" not in shell("pm", "clear", PACKAGE):
        raise RuntimeError("Could not reset Plainphone before Device Owner enrollment")
    # Grant roles on the fresh test phone before Device Owner applies the restrictions.
    shell("cmd", "role", "add-role-holder", "android.app.role.SMS", PACKAGE)
    shell("cmd", "role", "add-role-holder", "android.app.role.DIALER", PACKAGE)
    serial_shell(console, "dpm", "set-device-owner", f"{PACKAGE}/.PlainphoneAdminReceiver")
    instrument("DeviceOwnerFlow", port, token, console)

    serial = os.environ.get("ANDROID_SERIAL", "emulator-5554")
    response = adb("-s", serial, "emu", "sms", "send", PARENT_NUMBER, REPLY,
                   text=True, stdout=subprocess.PIPE).stdout
    if response.strip() != "OK":
        raise RuntimeError(f"Emulator rejected the incoming SMS: {response}")
    instrument("IncomingSmsFlow", port, token, console)


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    environment = dict(os.environ, PORT="0", PLAINPHONE_EMULATOR_E2E="1")
    console_port = int(os.environ.get("E2E_SERIAL_PORT", "5557"))
    with (
        socket.create_connection(("127.0.0.1", console_port), timeout=10) as console,
        tempfile.TemporaryDirectory() as temp,
        (ARTIFACTS / "server.log").open("w") as log,
    ):
        fixture = Path(temp) / "server.json"
        with subprocess.Popen(
            ["node", "--import", "tsx", "test/e2e/phone-sync-server.ts", str(fixture)],
            cwd=ROOT / "server", env=environment, stdout=log, stderr=subprocess.STDOUT,
        ) as server:
            try:
                for _ in range(120):
                    if fixture.exists() and fixture.stat().st_size:
                        break
                    if server.poll() is not None:
                        raise RuntimeError("Test server exited before writing the fixture")
                    time.sleep(1)
                else:
                    raise RuntimeError("Test server was not ready after 120 seconds")
                config = json.loads(fixture.read_text(encoding="utf-8"))
                run_flows(int(config["url"].rsplit(":", 1)[1]), config["parentToken"], console)
            except Exception as error:
                print(error, flush=True)
                capture(console, "screen.png")
                capture(console, "logcat.txt")
                raise
            finally:
                server.terminate()
                try:
                    server.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()


if __name__ == "__main__":
    main()
