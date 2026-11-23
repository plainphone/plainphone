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
| `SELF_UPDATES` | `true` | `false` (checked in `SelfUpdate`, `UpdateWorker`, `UpdateRequestListener` and the light-mode Today screen) |
| `MYSELF_PROFILE` | `true` | `false` (`SetupAudience.offered()`) |
| `disclosure(step)` | `null` | guard and location disclosures (`LightSetupActivity`) |
| `onStateChanged(context)` | nothing | shows or removes the notice (`MonitoringNotice`) |

The manifest differences are in `android/app/src/play/AndroidManifest.xml`, merged over the main
manifest. The flags are compile-time constants, so R8 drops the self-updater from the Play release:
`scripts/smoke-play-apk.sh` checks the APK has no update check and no download link.

If a phone that is already Device Owner runs the Play build (only by moving from a GitHub build
signed with the same key), it keeps working as before, except that it no longer updates itself and
approved install windows fail closed (the install restriction stays on) without the watchdog.

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
  activities, `isMonitoringTool` = `child_monitoring`, Child-only audiences, the notice shown when
  paired, back after a swipe and gone after release.
- `PlayDisclosureUiTest.kt` (Robolectric with Compose): setup without Myself, the guard disclosure
  before Android's accessibility list (with **Not now** and **Read it again**), the location
  disclosure before the permission request, **Not now** skipping location. Screenshots in light and
  dark: `android/app/build/screenshots/play-*.png`.
- `scripts/smoke-play-apk.sh` on the minified release APK in CI.

## Still open

- **Device admin.** The policy review recommends leaving the light-mode device admin step out of
  the Play edition ([policy-review.md](policy-review.md#device-admin)). It is still in, because the
  server and dashboard count a missing device admin as a broken light-mode lock
  (`LIGHT_LOCK` in `server/src/routes/device.ts`, `LIGHT_REQUIRED` in `web/src/pages/Phone.tsx`).
  The phone first has to report which edition it is, so the server can stop requiring it for Play
  phones.
- **The dashboard** still shows **Update now** and the app version check for Play phones; the
  phone ignores them.
- **A Myself phone moving to the Play build** keeps its profile. Play cannot be the source of a
  Myself install, since setup does not offer it.
- The review sign-in, the declarations and the videos in [policy-review.md](policy-review.md#what-the-phone-app-needs-before-play).
