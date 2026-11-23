# The Google Play edition of the phone app

The phone app (`android/`, `org.plainphone.app`) is built in two flavors of the `distribution`
dimension:

| Flavor | Where it goes | What it is |
|---|---|---|
| `github` (default) | GitHub Releases, F-Droid, the emulator suite | The whole app as before: light and strong mode, Child and Myself, the self-updater |
| `play` | Google Play | Light mode with the Child profile only, updated by Google Play |

The `github` flavor behaves exactly as the app did before the split: its merged manifests (debug
and release) and its runtime dependencies are identical to those of the previous single build.
Nothing has been uploaded to Play from here; see [README.md](README.md).

## What the Play edition leaves out and adds

| Change | Why | Policy |
|---|---|---|
| No self-updater: no update check against `/download/android/latest.json`, no download prompt or link to the APK, the dashboard's **Update now** does nothing, update checks left behind by a GitHub build are cancelled, no install watchdog (`FOREGROUND_SERVICE_SYSTEM_EXEMPTED`), no `REQUEST_INSTALL_PACKAGES` | "An app distributed via Google Play may not modify, replace, or update itself using any method other than Google Play's update mechanism." A monitoring app may also not link to an APK outside Play | [Device and Network Abuse](https://support.google.com/googleplay/android-developer/answer/9888379), [Malware, Stalkerware](https://support.google.com/googleplay/android-developer/answer/9888380) |
| No device admin: neither the Device Owner receiver (`PlainphoneAdminReceiver`) nor light mode's uninstall barrier (`LightAdminReceiver`) is in the manifest, and setup has no "Protect Plainphone" step | "Don't use device admin features to block uninstallation", and there is no parental control exception for device admin | [Malware](https://support.google.com/googleplay/android-developer/answer/9888380), [policy-review.md](policy-review.md#device-admin) |
| No Device Owner setup: the provisioning activities (`GET_PROVISIONING_MODE`, `ADMIN_POLICY_COMPLIANCE`) and the `PROVISIONING_SUCCESSFUL` entry point are removed from the manifest | Strong mode is installed from the QR code's download URL, never from Play, and Play Protect blocks unapproved DPCs during enrollment | [Android Enterprise DPC allowlist](https://support.google.com/work/android/answer/16694822) |
| Child profile only: setup offers **Child** and **Parent** (a pointer to the dashboard), not **Myself**, and the Parent screen has no "set up for yourself" button | Monitoring apps must be "exclusively designed and marketed for parents to monitor their children" | [Malware, Stalkerware](https://support.google.com/googleplay/android-developer/answer/9888380) |
| `<meta-data android:name="isMonitoringTool" android:value="child_monitoring" />` | Required in every version code on every track of a monitoring app | [Use of the isMonitoringTool flag](https://support.google.com/googleplay/android-developer/answer/12955211) |
| "Plainphone is on": a quiet, ongoing notification from pairing until Plainphone is switched off. A tap opens **What can my parents see?** | Monitoring apps "must present users with a persistent notification at all times when the app is running" | [Malware, Stalkerware](https://support.google.com/googleplay/android-developer/answer/9888380) |
| A separate disclosure with **Agree and continue** / **Not now** before the guard step opens Android's accessibility list | Prominent disclosure and affirmative consent before an AccessibilityService that is not an accessibility tool | [Use of the AccessibilityService API](https://support.google.com/googleplay/android-developer/answer/10964491) |
| A separate disclosure with **Allow location** / **Not now** before Android's location dialog, saying location is used "even when the app is closed or not in use" | Prominent disclosure in the form Google prescribes for location in the background | [Location in the background](https://support.google.com/googleplay/android-developer/answer/9799150) |
| `<queries>` instead of `QUERY_ALL_PACKAGES` | Broad package visibility is for "device search, antivirus apps, file managers, and browsers" | [QUERY_ALL_PACKAGES](https://support.google.com/googleplay/android-developer/answer/10158779) |
| Google Play Billing (already in `src/play` before the split, formerly `-PplainphonePlay=true`) | Digital goods sold in a Play app go through Play Billing | [docs/billing.md](../billing.md) |

The `isMonitoringTool` page shows the element inside `<manifest>`; Android's PackageManager only reads
`<meta-data>` inside `<application>` (and components), so the Play edition declares it
there. Check the uploaded bundle's manifest in Play Console's App bundle explorer after the first
upload.

### No device admin

In the GitHub edition, light mode asks to become device admin only so that uninstalling needs it
switched off first. The Play edition leaves both admin receivers out of its manifest and does not
call Android's device admin APIs (`Distribution.DEVICE_ADMIN` is `false`):

- Setup skips the "Protect Plainphone" step, and the step counter counts one step fewer.
- The phone leaves `deviceAdmin` out of `protections` and reports `distribution: "play"` in
  `PUT /device/status` ([sync-api.md](../sync-api.md)). The server then counts the light lock as
  intact with the other five protections; a report without `distribution` (every app from before
  this field) still needs all six.
- The dashboard and the parent app show no device admin row for the phone, and "What is weaker than
  strong mode" says that Plainphone can be uninstalled from Settings. The guard still closes
  Plainphone's app info page and the uninstall dialog, and the parents see the phone go quiet if it
  is uninstalled anyway.
- Switching Plainphone off has no "device admin off" step.

A light-mode phone that moves from a GitHub build to the Play build should lose its device admin when the
update removes the receiver (not yet tried on a phone); with `distribution: "play"` that is not a
broken lock.

### Where updates come from

With `distribution: "play"` the dashboard and the parent app show the app version and "Updated
through Google Play" instead of **Update now** and the check against the GitHub release, in all
five languages. It is a fact about the installed app, not a setting, so it has no toggle.

### The persistent notice

One notification on its own low-importance channel ("Plainphone is on"): no sound, no badge, no
pop-up. It says "Your parents' rules apply on this phone. Tap to see what they can see." in all
five languages. It is shown while the phone is paired and not released or removed, and updated when
the app starts, after every sync and when Plainphone is switched off. Android 14 lets the user swipe
an ongoing notification away; it comes back at once (its delete intent). If notifications are
switched off for Plainphone, Android shows nothing, and Play Protect still warns that a monitoring
app is on the phone.

This notice cannot be turned off in the Play edition, because Play requires it. The `github`
flavor does not show it. It is not a new feature for the parent, so it has no dashboard toggle.

### The disclosures

The texts are drafted from [permission-declarations.md](permission-declarations.md) and are in
`android/app/src/play/res/values*/strings_play.xml`.

- **Guard:** the disclosure replaces the guard step until the child agrees. **Agree and continue**
  opens Android's accessibility list at once. **Not now** opens nothing; the step says that without
  the guard Plainphone cannot close apps the parent has not allowed, and offers **Read it again**.
  The guard step is required, so setup waits there.
- **Location:** **Allow location** shows Android's permission dialog. **Not now** skips the
  optional step, exactly like its own skip button.
- The yes is stored per step on the phone and cleared when Plainphone is switched off or setup is
  undone. Nothing is enforced during setup, so the phone's own dialer, 112 and the help lines stay
  reachable on every path through these screens.

### Package visibility

`<queries>` makes these visible: launcher apps (the allowlist and app list), home screens, dialers
(`DIAL`, `tel:`), in-call services and SMS apps (`SMS_DELIVER`), the emergency dialer, cameras,
the alarm clock, contacts, Settings, map apps (`geo:`, always allowed) and Google Play services.
That covers everything light mode looks up. Two strong-mode features need every package and do not
work in the Play edition: the nightly app update window's list of installed apps
(`AppUpdateWindow`) and apps hidden by Device Owner. The Play edition offers no strong-mode setup,
so neither is reachable there.

## How the code is split

Flavor differences live behind `org.plainphone.app.distribution.Distribution`, one small object per
flavor (`android/app/src/github/java/…` and `android/app/src/play/java/…`):

| Member | `github` | `play` |
|---|---|---|
| `NAME` | `"github"` | `"play"` (`distribution` in `PUT /device/status`) |
| `SELF_UPDATES` | `true` | `false` (checked in `SelfUpdate`, `UpdateWorker`, `UpdateRequestListener` and the light-mode Today screen) |
| `DEVICE_ADMIN` | `true` | `false` (`LightSetup.steps()`, `Protections`, `LightLock`, `LightRelease`) |
| `MYSELF_PROFILE` | `true` | `false` (`SetupAudience.offered()`) |
| `disclosure(step)` | `null` | guard and location disclosures (`LightSetupActivity`) |
| `onStateChanged(context)` | nothing | shows or removes the notice (`MonitoringNotice`) |

The manifest differences are in `android/app/src/play/AndroidManifest.xml`, merged over the main
manifest. The flags are compile-time constants, so R8 drops the self-updater from the Play release:
`scripts/smoke-play-apk.sh` checks the APK has no update check and no download link.

A strong-mode (Device Owner) phone must stay on the GitHub build. The Play build has no Device
Owner receiver, so an update to it (only possible from a GitHub build signed with the same key)
would take away the component Android knows the Device Owner by. This has not been tried on a
phone.

## Building

```sh
cd android
./gradlew assemblePlayDebug                 # debug APK, debug key
./gradlew testPlayDebugUnitTest lintPlayDebug
PLAINPHONE_PLAY_UPLOAD=/path/to/play-upload.properties ./gradlew bundlePlayRelease
```

The bundle is `android/app/build/outputs/bundle/playRelease/app-play-release.aab`.

### Signing and upload

Play uses Play App Signing: Google signs what phones install, and the developer signs uploads with an
upload key.

- **App signing key:** choose "Use my own key" when the app is created in Play Console and upload the
  existing production key (the certificate in the [README](../../README.md#signing)), so Play
  installs, GitHub APKs and F-Droid builds share one signature and a phone can move between them
  without being reset. Play Console's "Export and upload a key from Java keystore" uses Google's
  `pepk` tool for this.
- **Upload key:** a separate keystore, outside the repository, kept with the other release secrets.
  Generate it with `keytool -genkeypair -keystore play-upload.jks -alias upload -keyalg RSA
  -keysize 4096 -validity 10000` and register its certificate in Play Console. Point
  `PLAINPHONE_PLAY_UPLOAD` at a properties file with the same four keys as `PLAINPHONE_SIGNING`
  (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`).
- Without `PLAINPHONE_PLAY_UPLOAD` the Play release uses `PLAINPHONE_SIGNING`; with neither it is
  unsigned (CI), so a debug-signed bundle can never be uploaded by mistake.
- No key, password or properties file is committed. A lost upload key can be reset in Play Console;
  the app signing key cannot.

## Tests

- `android/app/src/testPlay/…/PlayEditionTest.kt` (Robolectric, merged Play manifest): no update
  report, no work for **Update now**, inherited update checks cancelled and doing nothing, no
  `REQUEST_INSTALL_PACKAGES`, `QUERY_ALL_PACKAGES` or install watchdog permission, no provisioning
  activities, no device admin receiver and no device admin step, a light lock without device
  admin and `distribution` = `play`, `isMonitoringTool` = `child_monitoring`, Child-only
  audiences, the notice shown when paired, back after a swipe and gone after release.
- `android/app/src/testGithub/…/GithubEditionTest.kt`: both admin receivers, the device admin step
  and `distribution` = `github`.
- `server/test/light-mode.test.ts`: a `play` report is intact without `deviceAdmin`, a `github`
  report or one without the field is not. `web/src/pages/Phone.test.tsx`,
  `web/src/lib/phone-health.test.ts` and `parent-app/__tests__/phone-screens.test.tsx`: no
  **Update now** and no device admin row for a Play phone.
- `PlayDisclosureUiTest.kt` (Robolectric with Compose): setup without Myself, the guard disclosure
  before Android's accessibility list (with **Not now** and **Read it again**), the location
  disclosure before the permission request, **Not now** skipping location. Screenshots in light and
  dark: `android/app/build/screenshots/play-*.png`.
- `scripts/smoke-play-apk.sh` on the minified release APK in CI.

## Still open

- **A self-hosted server older than this change** does not know `distribution` and counts a Play
  phone's light lock as broken, because `deviceAdmin` is missing.
- **`POST /phones/{id}/update`** is still accepted for a Play phone (the dashboard no longer offers
  it); the phone ignores it.
- **A Myself phone moving to the Play build** keeps its profile. Play cannot be the source of a
  Myself install, since setup does not offer it.
- The review sign-in, the declarations and the videos in [policy-review.md](policy-review.md#what-the-phone-app-needs-before-play).
