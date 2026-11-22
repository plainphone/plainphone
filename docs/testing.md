# Android emulator end-to-end tests

The `android-e2e` CI job runs on GitHub-hosted Linux with KVM and AOSP
x86_64 system images for API 34 and API 29 (Android 10). It runs on main
pushes, on pull requests that change the Android app, server, workflow,
or emulator test inputs, and on demand (Actions → CI → Run workflow, which
runs every check on the chosen branch). Each leg has a 30-minute limit and restores a
pre-test emulator snapshot. The test run does not write back to that snapshot.

## Run locally

Install JDK 21, Node 24, pnpm, Python 3, and the Android SDK. Use a disposable
AOSP emulator with a root-capable system image and no accounts. The suite
changes the clock, accessibility settings and app roles, and leaves
Plainphone as Device Owner. Wipe the AVD before each run.

From the repository root, replace `34` with `29` for Android 10:

```sh
pnpm install --frozen-lockfile
sdkmanager 'platforms;android-37.0' 'build-tools;36.1.0' platform-tools emulator \
  'system-images;android-34;default;x86_64'
avdmanager create avd -n plainphone-e2e-34 -k 'system-images;android-34;default;x86_64' -d pixel
emulator -avd plainphone-e2e-34 -wipe-data -no-snapshot \
  -feature ModemSimulator -shell-serial tcp:127.0.0.1:5599,server,nowait
```

Leave the emulator running, unlock it, and complete any Android welcome
prompts without adding an account. In a separate terminal, from the repo root:

```sh
export ANDROID_SERIAL=emulator-5554
(cd android && ./gradlew --no-daemon --max-workers=2 \
  :app:assembleDebug :app:assembleDebugAndroidTest :e2e-fixture:assembleDebug)
python3 scripts/e2e-android-emulator.py
```

The harness starts the real server on a free loopback port, runs migrations,
and signs into a synthetic parent account. By default it starts an embedded
PostgreSQL instance. To use your own PostgreSQL, set `DATABASE_URL` to a
**disposable** database. The guest reaches the test server via the emulator’s
host loopback alias (`10.0.2.2`). The local serial console carries instrumentation
output after Device Owner policy disables ADB. The harness stops the server on exit.

The serial console listens on TCP port 5599 (`E2E_SERIAL_PORT` changes it). Keep
it outside 5555–5585: the adb server probes those ports for emulators and sends
its `CNXN` handshake into whatever answers, which corrupts the root shell. The
harness refuses such a port, checks that a shell answers on the socket before it
enrolls Device Owner, and stops with a clear error if adb data shows up there.
`python3 -m unittest scripts/test_e2e_android_emulator.py` tests this protocol
without an emulator.

On failure, look in `android/build/emulator-e2e/` or the CI artifact named
`android-e2e-api-<level>` for the screenshot, logcat, server log and
instrumentation output. Tests run once. Waiting for a UI or asynchronous
delivery result is bounded and does not repeat the action under test.

## Coverage

| Flow | What the emulator checks |
| --- | --- |
| Setup and rules | The Light setup screens confirm the child profile and PIN, and the Device Owner pairing activity redeems its pending token. Both flows must finish the sync the setup starts itself (reason `initial light setup` or `paired`, recorded through a test-only observer on `SyncRunner.run`) and have uploaded the first status and saved the first rules, before the test requests another sync. The 15-minute WorkManager sync registered during pairing does not satisfy this check. The fixture stages the pending QR token for the loopback server. Device Owner rules hide, reveal and hide the test APK again. |
| SOS and emergency access | Holding the child’s SOS button creates an incident in the parent API and a parent can mark it seen. The SOS emergency keypad opens. The public `placeCall` hands the exact 112, 911 and 114 addresses to `TelecomHandoff`, the single place where a call goes to Android's Telecom, and rejects an unapproved ordinary number. The test replaces only the last step of that hand-off with a recorder, so it places no calls. |
| Light mode | The accessibility guard stops a blocked app from staying in the foreground. Revoking an app while it floats in picture-in-picture removes its pinned task according to Android's activity manager. School time still blocks the app after the AOSP clock moves forward by 12 hours. |
| Quick messages | The child taps a quick message and the test gateway answers HTTP 429. The virtual modem loops the outgoing message back only when addressed to its virtual phone number. The test checks the exact body and number in the inbox before the emulator console injects a separate parent reply. |

The emulator covers the AOSP paths listed above. Hardware QR provisioning,
vendor restrictions, Play services, carrier delivery, real calls, PiP
audio, and the timing and hardware variants in the
[bypass checklist](bypass-checklist.md) still need physical devices. The
parent side of the suite uses the authenticated API. To test the phone sync
protocol without booting an emulator, run `scripts/e2e-phone-sync.sh`.
