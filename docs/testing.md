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
| Setup and rules | The Light setup screens confirm the child profile and PIN, and the Device Owner pairing activity redeems its pending token. Both flows must finish the sync the setup starts itself (reason `initial light setup` or `paired`, recorded through a test-only observer on `SyncRunner.run`) and have uploaded the first status and saved the first rules, before the test requests another sync. The 15-minute WorkManager sync registered during pairing does not satisfy this check. The fixture stages the pending QR token for the loopback server. Before the Device Owner pairing screen opens, the test replays the admin-enabled broadcast from `dpm set-device-owner` if that broadcast has not applied the first lock yet (`am instrument` usually force-stops the app before it finishes), and waits for the first lock that opens the PIN-free setup window. Device Owner rules hide, reveal and hide the test APK again. |
| SOS and emergency access | Holding the child’s SOS button creates an incident in the parent API and a parent can mark it seen. The SOS emergency keypad opens. The public `placeCall` hands the exact 112, 911 and 114 addresses to `TelecomHandoff`, the single place where a call goes to Android's Telecom, and rejects an unapproved ordinary number. The test replaces only the last step of that hand-off with a recorder, so it places no calls. |
| Light mode | The accessibility guard stops a blocked app from staying in the foreground. Revoking an app while it floats in picture-in-picture removes its pinned task according to Android's activity manager. Plainphone is not the default Home app in this flow, so Home opens Android's home-app chooser, as on a child's phone where no Home app was chosen; the guard has to close the window anyway. School time still blocks the app after the AOSP clock moves forward by 12 hours. |
| Quick messages | The child taps a quick message and the test gateway answers HTTP 429. The modem simulator loops the outgoing message back only when it is addressed to the SIM's own number, which the emulator gets with `-phone-number`. The test checks the exact body and number in the inbox before the emulator console injects a separate parent reply. |

The emulator covers the AOSP paths listed above. Hardware QR provisioning,
vendor restrictions, Play services, carrier delivery, real calls, PiP
audio, and the timing and hardware variants in the
[bypass checklist](bypass-checklist.md) still need physical devices (the
[DPC provisioning probe](#dpc-provisioning-probe) below gives a first answer
for QR setup on a Google Play image). The
parent side of the suite uses the authenticated API. To test the phone sync
protocol without booting an emulator, run `scripts/e2e-phone-sync.sh`.

## DPC provisioning probe

Google Play Protect now blocks QR setup of Device Owner apps that Android
Enterprise has not approved ([help page](https://support.google.com/work/android/answer/16694822),
[developer guidance](https://developers.google.com/android/play-protect/warning-dev-guidance#android_enterprise_dpc_enrollment)).
The guidance also says that sideloaded apps asking for SMS, notification
listener or accessibility access are blocked during enrollment, and Plainphone
asks for SMS and accessibility. The suite above cannot answer whether this hits
Plainphone: it uses AOSP images without Play Protect, and `dpm set-device-owner`
skips the setup wizard. The probe (issue #255) gives a first answer from an
emulator before anyone tries it on a real phone.

It is manual only, not run on pushes or pull requests and not a required check.
Start it from Actions → **DPC provisioning probe** → Run workflow (API level
36, 35 or 37.0, and optionally a release tag), or with
`gh workflow run dpc-provisioning-probe.yml -f api=36`. GitHub only offers
that once the workflow is on main. To run it from a branch, dispatch CI with
the probe switched on, which also runs every other check:
`gh workflow run ci.yml --ref <branch> -f dpc_probe=true`.

What the job does (`scripts/dpc-provisioning-probe.py`):

1. Downloads `plainphone-VERSION.apk` from the newest release (pre-releases
   count) or the chosen tag, and stops unless its SHA-256 and version match the
   release's `.apk.json`.
2. Builds the QR code with `scripts/provisioning-qr.py`, which reads the
   signature checksum from that APK. The download address is the release
   asset, the PIN is `000000`, and the server is `https://probe.invalid`, so the
   phone never pairs with a real server. The QR code is drawn on a 4:3 white
   camera frame, and the job checks with `zbarimg` that the frame decodes to
   exactly the payload.
3. Boots a fresh, wiped `google_apis_playstore` x86_64 image with the back
   camera showing that frame (`-camera-back imagefile:`). It stops without a
   conclusion if the image skips the setup wizard.
4. Waits for the welcome screen, taps an empty spot six times (one shell
   command, so the taps are quick), and checks that the screen changed.
5. Records every new screen (screenshot and `uiautomator` dump) and presses
   what a parent would press: *Accept & continue*, *Next*, *Continue*, the
   emulator's Wi-Fi and so on, never *Cancel* or *Stop setup*. If Play Protect
   offers *Install anyway*, the probe presses it, so the result also says
   whether a warning can be passed; a screen that offers *Install anyway* counts
   as a warning, even when its title says "Blocked by Play Protect". In the
   background it reads
   `dpm list-owners` every second.
6. Plainphone's own setup step turns adb off within seconds of becoming Device
   Owner. The probe only takes that as the lock when adb stays off for 30
   seconds over several checks (the raw states are in the timeline as
   `adb_state`); if adb comes back, it carries on. It then keeps taking screenshots through the emulator console
   (`adb emu screenrecord screenshot`) for a minute.

The artifact `dpc-provisioning-probe-api-<level>` holds `result.json`,
`screens/` (every wizard screen as PNG, plus the XML dump where one could be
read), `logcat.txt` (until adb went off), `logcat-highlights.txt` (Play Store,
package verification, managed provisioning and Plainphone lines),
`emulator.log`, `device_policy.txt` when adb was still on, `release.json` and
the camera frame.

`result.json` gives a `conclusion` (`provisioned`, `provisioned_after_warning`,
`blocked_by_play_protect` or `inconclusive`) and a `reason`. It also has
`play_protect` (shown, `block` or `warning`, the screen texts, whether
*Install anyway* was pressed), `provisioning_finished`, `device_owner` (`true`
from `dpm list-owners`, or `"inferred"` when adb went off for at least 30
seconds after Plainphone was installed and before dpm could be read; only the
Device Owner lock keeps adb off), the release, the image with its Play Store and Play
services versions, and a timeline. The job fails on `inconclusive`: the image
had no setup wizard, six taps did not open QR setup, setup stopped on an error
screen without a Play Protect screen, a screen stayed unchanged for 150
seconds, or there was no answer within 15 minutes. A block passes the job, with
a warning annotation, because the probe did answer the question.

### What matches a real QR setup and what does not

| Step | Same as a real phone | Different |
| --- | --- | --- |
| Setup wizard | Google's setup wizard on a Google Play image, with Play Store, Play services and Play Protect | An emulator image, not a certified phone from a maker. Its Play Store and Play services versions are the image's own (recorded in `result.json`) and may be older than a phone's |
| Opening QR setup | Six taps on the welcome screen | `input tap` instead of a finger |
| Scanning | The wizard's own QR reader reads the camera | The camera shows an image file: no lens, focus, glare or second screen |
| QR payload | Built by `scripts/provisioning-qr.py` in the same format as the dashboard | No enrollment token, the server is `https://probe.invalid`, and the APK comes from the GitHub release URL instead of `app.plainphone.org/download/android` |
| Download, checksum, install | Android's managed provisioning downloads the release-signed APK and checks its signature, and Play Protect checks the install as it would on a phone | The network is a GitHub runner in a data centre, not a home network |
| Device Owner and Plainphone's setup step | Real | Once adb is off, the probe can take screenshots but cannot tap, so it does not finish Plainphone's battery dialog or the rest of setup |
| Account | No Google account, as the setup guide says | Same |

Play Protect partly decides on Google's servers, so a result here is a strong
hint, not proof. A block on the emulator should be confirmed on one real phone
before acting on it, and a pass should be confirmed on a real phone with
current Play services before the setup guide says it works.

Other ways to start provisioning were ruled out because they skip the part
under test: `dpm set-device-owner` skips the wizard and Play Protect, an
`am start` of `PROVISION_MANAGED_DEVICE_FROM_TRUSTED_SOURCE` needs a signature
permission the shell does not have, `PROVISION_MANAGED_DEVICE` must come from
an already installed DPC, and the emulator has no NFC.

To check the probe's decisions without an emulator, run
`python3 -m unittest scripts/test_dpc_provisioning_probe.py` (the CI `changes`
job runs it on every run).
