# Android emulator end-to-end tests

The `android-e2e` CI job runs on GitHub-hosted Linux with KVM and AOSP
x86_64 system images for API 34 and API 29 (Android 10). It runs on main
pushes, on pull requests that change the Android app, server, workflow,
or emulator test inputs, and on demand (Actions → CI → Run workflow, which
runs every check on the chosen branch). Each leg has a 30-minute limit
and the API 34 leg restores a pre-test emulator snapshot. A leg without a
cached snapshot boots once and caches the snapshot right away, before any flow
runs, so the test run never writes back to it. The API 29 leg always cold-boots
(`-no-snapshot`, no AVD cache): after a snapshot load on API 29,
`sys.boot_completed` is 1 before the input service is published, so the
emulator action's own `input keyevent 82` fails and its shutdown then hangs.
The action has no input to skip that keyevent. A cold boot costs about a minute
more than a snapshot load. The flows step has its own 10-minute limit: a hang
then fails the step, the artifact below is still uploaded, and an always-run
step kills any emulator left behind, whereas a job that reaches its own limit
is cancelled without an artifact.

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
  -feature ModemSimulator -phone-number 15555215554 -shell-serial tcp:127.0.0.1:5599,server,nowait
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

Device Owner forces private DNS (DNS over TLS) to the host in the phone's rules
once the server says the DNS service has accepted its ClientID; until then it
keeps the QR code's provisioning host (`family.adguard-dns.com` by default).
CI has no DNS service that knows the test ClientIDs, and the production
resolver refuses them: Android then marks the network unvalidated and
WorkManager stops every sync. So in emulator mode (`PLAINPHONE_EMULATOR_E2E=1`)
the server's DNS stub refuses strong-mode phones, which stay on the provisioning
host as a real phone does while its ClientID is pending, and the per-phone host
suffix is the reserved `dns.e2e.invalid`. No emulator reaches the production
resolver. The JVM contract test (`scripts/e2e-phone-sync.sh`) still checks the
`.dns.plainphone.org` host.

The serial console listens on TCP port 5599 (`E2E_SERIAL_PORT` changes it). Keep
it outside 5555–5585: the adb server probes those ports for emulators and sends
its `CNXN` handshake into whatever answers, which corrupts the root shell. The
harness refuses such a port, checks that a shell answers on the socket before it
enrolls Device Owner, and stops with a clear error if adb data shows up there.
`python3 -m unittest scripts/test_e2e_android_emulator.py` tests this protocol
without an emulator.

A restored snapshot answers ADB before Android has its network and modem
back. Before the first flow, the harness waits until `dumpsys connectivity`
names a default network and `dumpsys telephony.registry` reports the modem
`IN_SERVICE` (an SMS sent out of service is dropped without a loopback).
Before each flow, it checks that the test server process is alive and answers
`/api/health` on the host. Each flow then waits until the guest itself reaches
`/api/health` through `10.0.2.2`. Every wait has a deadline and its error names the
last thing it saw. Every command on the serial console has one deadline for the
whole command, not one per read: kernel messages share the console and would
otherwise keep a stuck command alive. A command that overruns gets a Ctrl-C, so
the diagnostics after it still get a shell. On failure, the job log shows
whether the server was still running and the end of its log.

The test parent's number is the emulator's own SIM number, `+15555215554`
(`E2E_MODEM_NUMBER` changes it; pass the same 11 digits to `-phone-number`).
The modem simulator delivers an SMS back to the phone only when it is addressed
to the SIM's own number. For any other number it reports the SMS as sent and
drops it. Its default SIM profile holds `+15551234567`, not `1555521` plus the
console port, so the harness sets the SIM number itself instead of deriving it.

On failure, look in `android/build/emulator-e2e/` or the CI artifact named
`android-e2e-api-<level>` for the screenshot, logcat, server log and
instrumentation output. `connectivity.txt` (`dumpsys connectivity`: is the
network `VALIDATED`, which private DNS host is in force) and `jobscheduler.txt`
(`dumpsys jobscheduler org.plainphone.app`: the app's jobs, their unmet
constraints and stop reasons) show why a sync did not run. `radio.txt` is the
radio log buffer, where Android logs SMS sent to and received from the modem.
Before it saves the
logcat, the harness asks WorkManager to log every work request's state
(`WM-DiagnosticsWrkr` lines). These come over the serial console once Device
Owner policy has disabled ADB. The request is a broadcast sent as root,
because the lock's `DISALLOW_DEBUGGING_FEATURES` makes Android refuse
broadcasts from the shell user. A timed-out setup sync also lists every
`SyncWorker` request with its state and stop reason in the test failure. Tests run once. Waiting for a UI or asynchronous
delivery result is bounded and does not repeat the action under test.
Where a flow has to scroll to a button, it drags and holds still before lifting.
A quick swipe leaves a fling running, and a scrolling screen spends the next tap
on stopping the fling, so the tap never reaches the button.

## Coverage

| Flow | What the emulator checks |
| --- | --- |
| Setup and rules | The Light setup screens confirm the child profile and PIN, and the Device Owner pairing activity redeems its pending token. Both flows must finish a sync that leaves the new phone's rules saved (recorded through a test-only observer on `SyncRunner.run`, with the rules' phone id as each run left them) and have uploaded the first status, before the test requests another sync. The wait checks that condition, not a sync reason, because Device Owner setup saves the rules in the pairing screen's direct `setup finished` sync before the queued `paired` sync starts. The immediate sync slot (`plainphone-sync-now`) must then drain, and after Device Owner pairing one job in it must have succeeded: the slot keeps its first job, so a stuck one would swallow every later immediate sync (#236 saw one stay enqueued with 0 attempts). On a timeout the message lists each run and every SyncWorker request by its slot, with state, attempts, stop reason and initial delay. The fixture stages the pending QR token for the loopback server. Before the Device Owner pairing screen opens, the test replays the admin-enabled broadcast from `dpm set-device-owner` if that broadcast has not applied the first lock yet (`am instrument` usually force-stops the app before it finishes), and waits for the first lock that opens the PIN-free setup window. Device Owner rules hide, reveal and hide the test APK again. |
| SOS and emergency access | Holding the child’s SOS button creates an incident in the parent API and a parent can mark it seen. The SOS emergency keypad opens. The public `placeCall` hands the exact 112, 911 and 114 addresses to `TelecomHandoff`, the single place where a call goes to Android's Telecom, and rejects an unapproved ordinary number. The test replaces only the last step of that hand-off with a recorder, so it places no calls. |
| Light mode | The accessibility guard stops a blocked app from staying in the foreground. Revoking an app while it floats in picture-in-picture removes its pinned task according to Android's activity manager. Plainphone is not the default Home app in this flow, so Home opens Android's home-app chooser, as on a child's phone where no Home app was chosen; the guard has to close the window anyway. School time still blocks the app after the AOSP clock moves forward by 12 hours. |
| Quick messages | The child taps a quick message and the test gateway answers HTTP 429. The modem simulator loops the outgoing message back only when it is addressed to the SIM's own number, which the emulator gets with `-phone-number`. The test checks the exact body and number in the inbox before the emulator console injects a separate parent reply. |

The emulator covers the AOSP paths listed above. Hardware QR provisioning,
vendor restrictions, Play services, carrier delivery, real calls, PiP
audio, and the timing and hardware variants in the
[bypass checklist](bypass-checklist.md) still need physical devices. The
parent side of the suite uses the authenticated API. To test the phone sync
protocol without booting an emulator, run `scripts/e2e-phone-sync.sh`.
