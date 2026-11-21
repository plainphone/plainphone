# Android emulator end-to-end tests

The `android-e2e` CI job runs on GitHub-hosted Linux with KVM and AOSP
x86_64 system images for API 34 and API 29 (Android 10). It runs on main
pushes and on pull requests that change the Android app, server, workflow,
or emulator test inputs. Each leg has a 30-minute limit and restores a
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
  -shell-serial tcp:127.0.0.1:5557,server,nowait
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

On failure, look in `android/build/emulator-e2e/` or the CI artifact named
`android-e2e-api-<level>` for the screenshot, logcat, server log and
instrumentation output. Tests run once. Waiting for a UI or asynchronous
delivery result is bounded and does not repeat the action under test.

## Coverage

| Flow | What the emulator checks |
| --- | --- |
| Setup and rules | Real enrollment and first status upload, plus Android hiding, revealing and hiding a test APK again as the parent changes its rules. The test supplies the QR enrollment token directly. |
| SOS and emergency access | Holding the child’s SOS button creates an incident in the parent API and a parent can mark it seen. The emergency keypad opens, and the enforced contact policy allows 112, 911 and 114. The test does not place emergency calls. |
| Light mode | The accessibility guard stops a blocked app from staying in the foreground. Revoking an app while it floats in picture-in-picture removes the test window. School time still blocks the app after the AOSP clock moves forward by 12 hours. |
| Quick messages | A test gateway returns one HTTP 429 for the send request and the app submits the fallback through Android’s SMS API. The emulator console injects an approved parent reply and the child’s inbox receives it. |

The emulator covers the AOSP paths listed above. Hardware QR provisioning,
vendor restrictions, Play services, carrier delivery, real calls, PiP
audio, and the timing and hardware variants in the
[bypass checklist](bypass-checklist.md) still need physical devices. The
parent side of the suite uses the authenticated API. To test the phone sync
protocol without booting an emulator, run `scripts/e2e-phone-sync.sh`.
