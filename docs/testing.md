# Android emulator end-to-end tests

The `android-e2e` CI job runs on GitHub-hosted Linux with KVM and AOSP
x86_64 system images for API 34 and API 29 (Android 10). It runs on main
pushes, on pull requests that change the Android app, server, workflow,
or emulator test inputs, and on demand (Actions → CI → Run workflow, which
runs every check on the chosen branch). Each leg has a 30-minute limit
and restores a pre-test emulator snapshot. The test run does not write
back to that snapshot. Each of the two flows (light mode, then Device Owner)
must finish within 12 minutes. The light-mode flow includes one minute of
app use for its time limit.

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

Texts and calls from other numbers come from the emulator console (`adb emu sms send`,
`adb emu gsm call`), which the modem then delivers to Android as a network would. The test
asks for them over the test server: it posts the command to `/e2e/console`, the harness polls
`/e2e/console/next`, runs it and posts the console's output back, and the test asserts the
console answered `OK`. The test server (`server/test/e2e/phone-sync-server.ts`) offers these
routes only in emulator mode and only to the test parent, and both it and the harness accept
nothing but an SMS or an incoming call from a number. `scripts/test_e2e_android_emulator.py`
covers the harness side.

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

## Coverage

| Flow | What the emulator checks |
| --- | --- |
| Setup and rules | The Light setup screens confirm the child profile and PIN, and the Device Owner pairing activity redeems its pending token. Both flows must finish the sync the setup starts itself (reason `initial light setup` or `paired`, recorded through a test-only observer on `SyncRunner.run`) and have uploaded the first status and saved the first rules, before the test requests another sync. The 15-minute WorkManager sync registered during pairing does not satisfy this check. The fixture stages the pending QR token for the loopback server. Before the Device Owner pairing screen opens, the test replays the admin-enabled broadcast from `dpm set-device-owner` if that broadcast has not applied the first lock yet (`am instrument` usually force-stops the app before it finishes), and waits for the first lock that opens the PIN-free setup window. Device Owner rules hide, reveal and hide the test APK again. |
| SOS and emergency access | Holding the child’s SOS button creates an incident in the parent API and a parent can mark it seen. The SOS emergency keypad opens. The public `placeCall` hands the exact 112, 911 and 114 addresses to `TelecomHandoff`, the single place where a call goes to Android's Telecom, and rejects an unapproved ordinary number. The test replaces only the last step of that hand-off with a recorder, so it places no calls. |
| Light mode | The accessibility guard stops a blocked app from staying in the foreground. Revoking an app while it floats in picture-in-picture removes its pinned task according to Android's activity manager. Plainphone is not the default Home app in this flow, so Home opens Android's home-app chooser, as on a child's phone where no Home app was chosen; the guard has to close the window anyway. |
| Light mode after a date jump | The phone is set up in `Europe/Copenhagen`, where the app catalog exists. The test app uses up a one-minute limit, measured from Android's usage events (usage access is granted from the shell, as a parent does in Settings). Five Play windows for a catalog app open and close through `InstallWindow.openForParent`, the call the maintenance screen makes after the parent PIN, and a sixth is refused. One emergency opening is counted through the phone's real opening store and trusted clock with a Self rule of one a month; the flow's phone is a Child phone, so the Self setup and the stop screen's button are not part of it. Then the AOSP clock moves forward 35 days, into another day and month. School time still blocks the app, the used minute still counts, there is no sixth Play window and no new opening. If the run starts in the last 10 minutes before midnight (more than the flow's slowest path takes) (phone or system time zone), the flow first waits until midnight has passed, so these counts cannot start over for a real reason. |
| Quick messages | The child taps a quick message and the test gateway answers HTTP 429. The modem simulator loops the outgoing message back only when it is addressed to the SIM's own number, which the emulator gets with `-phone-number`. The test checks the exact body and number in the inbox before the emulator console injects a separate parent reply. |
| Calls and texts (Device Owner) | The keypad, opened with a `tel:` number as a link in another app opens it, refuses a number that is not approved, shows "Only approved contacts can be called" and hands nothing to Telecom. A call the shell places with `ACTION_CALL` (standing in for the maker's dialer or a contact card) is ended, logged and shows the "Call not allowed" notification. A stranger's SMS from the modem is logged as blocked, with no notification and nothing in the inbox. A contact entered in the dashboard as `+1 202 555 0123` texts from the national number `2025550123` (the emulator SIM is a US SIM) and the message is in the inbox under the contact's name. The server strips the spaces before it stores a number, so the phone matches `+12025550123` against `2025550123`: this covers the with/without country code half of C17, not spaces on the phone. 114 is placed through the real Telecom (Android does not treat it as an emergency number on this SIM, which the test checks), hung up, and opens no call-back window: a stranger's call afterwards is still rejected and logged. The modem answers an outgoing call about a second after dialling, so the test cannot hold 114 before it connects; 114 must not open the window either way. |
| Clock policy (Device Owner) | Automatic date and time are forced and `DISALLOW_CONFIG_DATE_TIME` is set. On Android 11 and later, automatic time zone is forced too, and Android's time and time zone detectors, which Settings → Date & time uses, refuse to turn automatic detection off or take a manual time or zone. Android 10 can only require automatic time. A privileged shell then writes the raw `auto_time` settings to 0 (a child has no shell: adb is off). The test logs whether Android refused each write or took it, and asserts that after Plainphone's lock check both are forced again; it does not assume which of the two kept them on. |

The emulator covers the AOSP paths listed above. Hardware QR provisioning,
vendor restrictions, Play services, carrier delivery, real calls, PiP
audio, and the timing and hardware variants in the
[bypass checklist](bypass-checklist.md) still need physical devices. The
parent side of the suite uses the authenticated API. To test the phone sync
protocol without booting an emulator, run `scripts/e2e-phone-sync.sh`.
