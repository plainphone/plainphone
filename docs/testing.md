# Android emulator end-to-end tests

The `android-e2e` CI job runs on GitHub-hosted Linux with KVM and AOSP
x86_64 system images for API 34 and API 29 (Android 10). It runs on main
pushes, on pull requests that change the Android app, server, workflow,
or emulator test inputs, and on demand (Actions → CI → Run workflow, which
runs every check on the chosen branch). Each leg has a 45-minute limit
and the API 34 leg restores a pre-test emulator snapshot. A leg without a
cached snapshot boots once and caches the snapshot right away, before any flow
runs, so the test run never writes back to it. The API 29 leg always cold-boots
(`-no-snapshot`, no AVD cache): after a snapshot load on API 29,
`sys.boot_completed` is 1 before the input service is published, so the
emulator action's own `input keyevent 82` fails and its shutdown then hangs.
The action has no input to skip that keyevent. A cold boot costs about a minute
more than a snapshot load. The flows step has its own 25-minute limit: a hang
then fails the step, the artifact below is still uploaded, and an always-run
step kills any emulator left behind, whereas a job that reaches its own limit
is cancelled without an artifact. The light-mode flow must finish within 15
minutes and the Device Owner flow within 7. The light-mode flow includes one
minute of app use for its time limit, and if it reaches its counting steps in
the last ten minutes of a day it first waits for midnight, so nothing it counts
per day starts over mid-test.

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
  :app:assembleGithubDebug :app:assembleGithubDebugAndroidTest :e2e-fixture:assembleDebug)
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
the diagnostics after it still get a shell. Its error names the command by what
it does, not by the `su 0 nsenter` prefix it runs behind (`DeviceOwnerFlow (am
instrument) did not finish`, not `su did not finish`). It also says either that
no shell ever started the command or what the command printed last. Each flow also has a watchdog
(`FlowWatchdog`) that fails it 60 seconds before the harness's limit for that
flow (16 minutes for light mode, so its watchdog still allows the 11-minute
midnight wait plus the flow; 7 for Device Owner). A call that never returns
then fails the flow with the step it was at and the stack traces of the flow and
the app's main thread, and logcat gets every thread in parts below its 4 KB
entry limit (tag `PlainphoneE2E`, which also logs each step as it starts).
The stuck call itself cannot be stopped, so after a watchdog failure the flow's
`finally` blocks do not run; after the light flow, the clock then stays 35 days
ahead for the rest of the run. On failure, the job log shows whether the
server was still running and the end of its log.
In the light flow, a wait for the player to leave the foreground or
picture-in-picture names, when it fails, what the guard took for the app in
front and for the floating app, the stored plan and synced rules for the player,
and Android's resumed activities and pinned task.

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
| Light mode | The accessibility guard stops a blocked app from staying in the foreground. Revoking an app while it floats in picture-in-picture removes its pinned task according to Android's activity manager. Plainphone is not the default Home app in this flow, so Home opens Android's home-app chooser, as on a child's phone where no Home app was chosen; the guard has to close the window anyway. |
| Light mode after a date jump | The phone is set up in `Europe/Copenhagen`, where the app catalog exists. The test app uses up a one-minute limit, measured from Android's usage events (usage access is granted from the shell, as a parent does in Settings). Five Play windows for a catalog app open and close through `InstallWindow.openForParent`, the call the maintenance screen makes after the parent PIN, and a sixth is refused. One emergency opening is counted through the phone's real opening store and trusted clock with a Self rule of one a month; the flow's phone is a Child phone, so the Self setup and the stop screen's button are not part of it. Then the AOSP clock moves forward 35 days, into another day and month. School time still blocks the app, the used minute still counts, there is no sixth Play window and no new opening. If the run starts in the last 10 minutes before midnight (more than the flow's slowest path takes) (phone or system time zone), the flow first waits until midnight has passed, so these counts cannot start over for a real reason. |
| Quick messages | The child taps a quick message and the test gateway answers HTTP 429. The modem simulator loops the outgoing message back only when it is addressed to the SIM's own number, which the emulator gets with `-phone-number`. The test checks the exact body and number in the inbox before the emulator console injects a separate parent reply. |
| Calls and texts (Device Owner) | The keypad, opened with a `tel:` number as a link in another app opens it, refuses a number that is not approved, shows "Only approved contacts can be called" and hands nothing to Telecom. A call the shell places with `ACTION_CALL` (standing in for the maker's dialer or a contact card) is ended, logged and shows the "Call not allowed" notification. A stranger's SMS from the modem is logged as blocked, with no notification and nothing in the inbox. A contact entered in the dashboard as `+1 202 555 0123` texts from the national number `2025550123` (the emulator SIM is a US SIM) and the message is in the inbox under the contact's name. The server strips the spaces before it stores a number, so the phone matches `+12025550123` against `2025550123`: this covers the with/without country code half of C17, not spaces on the phone. 114 is placed through the real Telecom (Android does not treat it as an emergency number on this SIM, which the test checks), hung up, and opens no call-back window: a stranger's call afterwards is still rejected and logged. The modem answers an outgoing call about a second after dialling, so the test cannot hold 114 before it connects; 114 must not open the window either way. Before the stranger calls, the test checks that the modem itself has no call left, not only Telecom: on Android 10 an early hang-up once left 114 live on the modem, the phone process restarted, and Telecom handed the stranger over as a call of unknown direction, which was ended but logged as outgoing. Such a call now counts as outgoing only when the phone dialled that number in the last minute, otherwise as a blocked incoming call (issue #273, Robolectric in `OutgoingCallEndTest`). |
| Clock policy (Device Owner) | Automatic date and time are forced and `DISALLOW_CONFIG_DATE_TIME` is set. On Android 11 and later, automatic time zone is forced too, and Android's time and time zone detectors, which Settings → Date & time uses, refuse to turn automatic detection off or take a manual time or zone. Android 10 can only require automatic time. A privileged shell then writes the raw `auto_time` settings to 0 (a child has no shell: adb is off). The test logs whether Android refused each write or took it, and asserts that after Plainphone's lock check both are forced again; it does not assume which of the two kept them on. |

The emulator covers the AOSP paths listed above. Hardware QR provisioning,
vendor restrictions, Play services, carrier delivery, real calls, PiP
audio, and the timing and hardware variants in the
[bypass checklist](bypass-checklist.md) still need physical devices (the
[DPC provisioning probe](#dpc-provisioning-probe) below explains why the
emulator cannot test QR setup on a Google Play image). The
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
skips the setup wizard. The probe (issue #255) was meant to give a first
answer from an emulator before anyone tries it on a real phone.

**Status: no SDK emulator image can run the QR path.** The six-tap QR reader
is part of Google's setup wizard (`com.google.android.setupwizard`), and none
of the SDK's Google Play images has it (see
[Why the emulator has no QR path](#why-the-emulator-has-no-qr-path)). The probe
now checks for the wizard right after boot and stops without a conclusion if
it is missing, so a run on a new image tells at once whether that image is any
different. The question has to be answered on a real phone.

It is manual only, not run on pushes or pull requests and not a required check.
Start it from Actions → **DPC provisioning probe** → Run workflow (API level
36, 35, 34, 36.1 or 37.0; image tag `google_apis_playstore`, or
`google_apis_playstore_ps16k` from API 35; optionally a release tag), or with
`gh workflow run dpc-provisioning-probe.yml -f api=36 -f image_tag=google_apis_playstore`.
GitHub only offers that once the workflow is on main. To run it from a branch,
dispatch CI with the probe switched on, which also runs every other check:
`gh workflow run ci.yml --ref <branch> -f dpc_probe=true -f dpc_probe_api=36 -f dpc_probe_image_tag=google_apis_playstore`.

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
3. Boots a fresh, wiped Google Play x86_64 image (the chosen API level and
   tag) with the back camera showing that frame (`-camera-back imagefile:`).
   It lists the packages (`pm list packages -u`) and stops without a
   conclusion if Google's setup wizard is not installed, if setup was already
   marked complete (`user_setup_complete=1`), or if Plainphone is already
   Device Owner. It never changes settings to get past this.
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

The artifact `dpc-provisioning-probe-api-<level>-<image tag>` holds `result.json`,
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
services versions, `setup_wizard` (whether `com.google.android.setupwizard` is
installed, and every setup package found), and a timeline. The job fails on
`inconclusive`: the image has no Google setup wizard or had already finished
setup, six taps did not open QR setup, setup stopped on an error
screen without a Play Protect screen, a screen stayed unchanged for 150
seconds, or there was no answer within 15 minutes. A block passes the job, with
a warning annotation, because the probe did answer the question.

### What matches a real QR setup and what does not

| Step | Same as a real phone | Different |
| --- | --- | --- |
| Setup wizard | Google's setup wizard on a Google Play image, with Play Store, Play services and Play Protect | **Not met by any SDK image so far:** they ship the emulator's setup stub instead of Google's wizard (see below). If an image ever has the wizard: an emulator image, not a certified phone from a maker, and its Play Store and Play services versions are the image's own (recorded in `result.json`) and may be older than a phone's. The probe changes no settings to reach the wizard, so a run that gets past this step starts from the same state as a factory-new phone |
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

### Why the emulator has no QR path

The first CI run (API 36, `google_apis_playstore`) stopped with
`user_setup_complete=1` and "Device provisioned: true". To find a way to the
wizard, the images themselves were taken apart (November 2026: each
`super` partition unpacked and its app folders listed with `dump.erofs`, or
`debugfs` for API 34). Every Google Play x86_64 image checked has the same
setup apps: API 34 (r14), 35 (r09), 36 (r07), 36 `ps16k` (r07) and 37.0 (r08).
None has `SetupWizardPrebuilt`. API 36.1 (r04) was not unpacked; it is offered
as an input so one CI run can check it. Their only setup-wizard app is
`GoogleSdkSetup` (`com.google.android.googlesdksetup`, a Home activity in the
`SETUP_WIZARD` category). It wraps the emulator's
[`ProvisionActivity`](https://android.googlesource.com/device/generic/goldfish/+/refs/heads/main/provision/EmulatorProvisonLib/src/com/android/sdksetup/ProvisionActivity.java),
which sets `user_setup_complete` and `device_provisioned` to 1 at first boot
and then disables itself. It has no QR reader. The images also carry
`ro.test_harness=1`, and API 34 sets `ro.setupwizard.mode=DISABLED`. The list
of images is in the SDK's
[repository manifest](https://dl.google.com/android/repository/sys-img/google_apis_playstore/sys-img2-4.xml).

| Candidate | Verdict | Why |
| --- | --- | --- |
| Put `device_provisioned` and `user_setup_complete` back to 0 and start `com.google.android.setupwizard` | Rejected | The package is not on the image, so there is nothing to start. Even on an image with the wizard it would not work: [`DevicePolicyManagerService`](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/devicepolicy/java/com/android/server/devicepolicy/DevicePolicyManagerService.java) keeps its own copy of "setup complete". `updateUserSetupCompleteAndPaired()` only ever sets it to true, and `checkDeviceOwnerProvisioningPreConditionLocked()` then answers `STATUS_USER_SETUP_COMPLETED` to managed provisioning. Only the test API `forceUpdateUserSetupComplete()` (permission `MANAGE_PROFILE_AND_DEVICE_OWNERS`) resets that copy, and that is no longer a factory-new phone |
| `ro.setupwizard.mode`, an emulator `-prop`, or a `config.ini` setting | Rejected | The property only tells an installed Google wizard how to behave, and there is none. `ro.*` properties are read-only, and the Play images are `user` builds without `adb root` |
| Another image tag or API level (`google_apis_playstore_ps16k`, API 34, 35, 37.0) | Rejected after checking | Same setup apps on every image checked. API 36.1 is not checked yet. The `api` and `image_tag` inputs stay, so 36.1 or a future image can be tried with one run; the probe reports `setup_wizard` straight after boot |
| Installing Google's setup wizard APK | Rejected | It is a privileged system app. A `user` build without root cannot add privileged apps, and the APK may not be redistributed |
| Re-enabling a disabled setup component with `pm enable` | Rejected | [Reported](https://stackoverflow.com/questions/72329296) to reboot to the home screen without a wizard on an Android 12 emulator, and here the wizard package is missing, not disabled |
| `dpm set-device-owner`, `PROVISION_MANAGED_DEVICE_FROM_TRUSTED_SOURCE`, `PROVISION_MANAGED_DEVICE`, NFC | Rejected | They skip the wizard's QR reader or Play Protect (see above) |

The unpacking was done by hand and cannot be repeated from this repository.
The probe repeats the decisive check on every run: it lists the image's
packages after boot and records `setup_wizard` and `device_provisioned` in
`result.json`, so one CI run per image confirms or overturns the table. Until
an image with the Google wizard turns up, every run ends `inconclusive`
(a red job) by design, and it does not answer #255.

Issue #255 therefore needs a real phone with Google Play services: factory
reset, six taps on the welcome screen, scan the dashboard's QR code, and note
what [the setup guide](setup-test-phone.md) asks for.

To check the probe's decisions without an emulator, run
`python3 -m unittest scripts/test_dpc_provisioning_probe.py` (the CI `changes`
job runs it on every run).
