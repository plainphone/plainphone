#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Run the emulator suite against a disposable Plainphone test server."""
import base64
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import shlex
import socket
import subprocess
import tempfile
from threading import Event
import time
from urllib.request import Request, urlopen
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path(os.environ.get("E2E_ARTIFACTS", ROOT / "android/build/emulator-e2e"))
PACKAGE = "org.plainphone.app"
REPLY = "Emulator parent reply"


def adb(*args, **kwargs):
    return subprocess.run(("adb", *args), timeout=kwargs.pop("timeout", 30), check=True, **kwargs)


def shell(*args):
    return adb("shell", *args, text=True, stdout=subprocess.PIPE).stdout


# adb's server probes these emulator ports (ADB_LOCAL_TRANSPORT_MAX_PORT moves the end)
# and sends its CNXN handshake to whatever answers, so the serial console must not use one.
ADB_SCAN_PORTS = range(5555, int(os.environ.get("ADB_LOCAL_TRANSPORT_MAX_PORT", "5585")) + 1)
DEFAULT_SERIAL_PORT = 5599


def serial_port(environment=os.environ):
    port = int(environment.get("E2E_SERIAL_PORT", DEFAULT_SERIAL_PORT))
    if port in ADB_SCAN_PORTS:
        raise RuntimeError(f"Serial console port {port} is in adb's emulator scan range "
                           f"{ADB_SCAN_PORTS.start}-{ADB_SCAN_PORTS.stop - 1}; adb would write into the root shell")
    return port


def connect_console(port, attempts=30):
    # The emulator opens the serial socket while it boots.
    for attempt in range(attempts):
        try:
            return socket.create_connection(("127.0.0.1", port), timeout=10)
        except OSError:
            if attempt == attempts - 1:
                raise
            time.sleep(2)


def probe_console(console, attempts=12, timeout=10):
    # Prove that a shell answers on this socket before trusting it with the
    # suite. The console service may still be starting, so resend until it answers.
    for attempt in range(attempts):
        try:
            serial_shell(console, "true", timeout=timeout)
            return
        except TimeoutError:
            if attempt == attempts - 1:
                raise RuntimeError("No shell answered on the emulator serial console") from None


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
            if b"CNXN" in line:
                raise RuntimeError("adb is connected to the serial console socket; "
                                   "move -shell-serial outside adb's emulator ports")
            content = line.rstrip(b"\r\n")
            if content == start:
                started = True
            elif started and content.startswith(end):
                result = output.decode(errors="replace").replace("\r\n", "\n")
                status = content[len(end):].decode(errors="replace")
                if not status.isdigit():
                    raise RuntimeError(f"Unexpected data on the emulator serial console: {status!r}")
                if status != "0":
                    raise RuntimeError(f"Emulator serial command failed: {args[0]} ({status})\n{result}")
                return result
            elif started:
                output.extend(line)
    raise RuntimeError("Emulator serial console disconnected")


def instrument(flow, port, token, console=None, command_prefix=(), *, parent_number=None):
    command = (
        "am", "instrument", "-w", "-r", "-e", "class",
        f"{PACKAGE}.e2e.{flow}", "-e", "port", str(port), "-e", "parentToken",
        token,
    )
    if parent_number is not None:
        command += ("-e", "parentNumber", parent_number)
    command += (f"{PACKAGE}.test/androidx.test.runner.AndroidJUnitRunner",)
    if console is None:
        result = adb("shell", *command, text=True, stdout=subprocess.PIPE,
                     stderr=subprocess.STDOUT, timeout=240).stdout
    else:
        result = serial_shell(console, *command_prefix, *command, timeout=240)
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
                result = serial_shell(console, "sh", "-c", "screencap -p | base64", timeout=20)
                # A kernel message can appear on the serial console between encoded lines.
                encoded = "".join(line for line in result.splitlines()
                                  if re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", line))
                out.write(base64.b64decode(encoded, validate=True))
            else:
                out.write(serial_shell(console, "logcat", "-d", "-v", "threadtime", "-t", "5000", timeout=20).encode())
    except (EOFError, OSError, RuntimeError, ValueError, subprocess.SubprocessError) as exc:
        print(f"Unable to collect {label}: {exc}", flush=True)


def run_flows(port, token, console):
    if shell("getprop", "ro.kernel.qemu").strip() != "1":
        raise RuntimeError("Select a disposable Android emulator")
    serial = adb("get-serialno", text=True, stdout=subprocess.PIPE).stdout.strip()
    match = re.fullmatch(r"emulator-(5[0-9]{3})", serial)
    if not match:
        raise RuntimeError("Select an emulator by its console-port serial")
    # AOSP derives the virtual modem's phone number from the emulator console port.
    parent_number = f"+1555521{match[1]}"
    if shell("getprop", "init.svc.console").strip() != "running":
        # Android 10 labels the emulator UART as a generic serial device; init
        # needs the console label to open it. Keep SELinux enforcing.
        shell("su", "0", "chcon", "u:object_r:console_device:s0", "/dev/ttyS0")
        shell("su", "0", "start", "console")
    probe_console(console)
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
    system_pid = shell("su", "0", "pidof", "system_server").strip()
    if not re.fullmatch(r"[1-9][0-9]*", system_pid):
        raise RuntimeError("Could not locate Android's running system process")
    # The serial console starts before Android loads the ART classpaths and
    # switches mount namespaces. Match the runtime environment of the adb shell.
    classpaths = "/data/local/tmp/plainphone-art.env"
    with tempfile.NamedTemporaryFile(mode="w") as environment:
        for name in ("BOOTCLASSPATH", "DEX2OATBOOTCLASSPATH"):
            try:
                value = shell("printenv", name).strip()
            except subprocess.CalledProcessError:
                continue
            environment.write(f"export {name}={shlex.quote(value)}\n")
        environment.flush()
        adb("push", environment.name, classpaths)
    android_runtime = (
        "su", "0", "nsenter", f"--mount=/proc/{system_pid}/ns/mnt", "--",
        "sh", "-c", f'. {classpaths}; exec "$@"', "sh",
    )
    serial_shell(console, *android_runtime, "dpm", "set-device-owner", f"{PACKAGE}/.PlainphoneAdminReceiver")
    stop = Event()
    with ThreadPoolExecutor(max_workers=1) as executor:
        reply = executor.submit(inject_parent_sms, port, token, stop, serial, parent_number)
        try:
            instrument("DeviceOwnerFlow", port, token, console, android_runtime, parent_number=parent_number)
            if not reply.result(timeout=5):
                raise RuntimeError("SMS injection stopped before delivery")
        finally:
            stop.set()


def inject_parent_sms(port, token, stop, serial, parent_number):
    # Inject a separate reply only once the child has observed the modem loopback.
    request = Request(f"http://127.0.0.1:{port}/e2e/quick-message-requests",
                      headers={"Authorization": f"Bearer {token}"})
    while not stop.wait(0.25):
        with urlopen(request, timeout=5) as reply:
            if json.load(reply)["smsObserved"]:
                response = adb("-s", serial, "emu", "sms", "send", parent_number, REPLY,
                               text=True, stdout=subprocess.PIPE).stdout
                if response.strip() != "OK":
                    raise RuntimeError(f"Emulator rejected the incoming SMS: {response}")
                return True
    return False


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    environment = dict(os.environ, PORT="0", PLAINPHONE_EMULATOR_E2E="1")
    with (
        connect_console(serial_port()) as console,
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
