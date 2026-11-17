# Android updates

## First update on an already locked phone

On the phone, tap **Version** seven times. Enter the parent PIN and choose
**Lift the lock for 30 min**. Open Chrome, go to
`https://app.plainphone.org/download/android`, and download the APK. Allow Chrome to
install it if Android asks, then tap **Update**. Open Plainphone and choose **Lock now**.
The first build with self-update must use the same signing key as the installed app.
On a strong-mode phone, use **Open battery settings** on the parent PIN screen to
exempt Plainphone from battery optimization if needed. The phone keeps the install
restriction in place for self-updates and approved catalog installs until the exemption
is enabled.

## Release assets

Run this after signing the final APK and upload both files to the same GitHub release.

```sh
scripts/android-release-metadata.sh /path/to/build-tools/aapt2 plainphone-VERSION.apk
```

The script reads the manifest's version code and name and hashes the signed bytes.
The server serves this information at `/download/android/latest.json`, together
with the selected APK's URL. It caches the release and metadata for up to 10 minutes.
Publishing a release still requires increasing `versionCode` and using the same signing
key. Provisioning continues to use the stable `/download/android` redirect.

For a custom `APK_DOWNLOAD_URL`, host its JSON at an HTTPS URL and set
`APK_METADATA_URL` to that URL. The JSON contains `versionCode`, `versionName`, and
`sha256`. Legacy servers or custom URLs without metadata fall back to downloading
and inspecting the APK in strong mode. Light mode needs metadata to offer an update.

Strong mode checks the installed package name, exact current signer set, and strictly
increasing version code before asking Android to install. When supplied, the file hash and
version code must also match the metadata. Android checks the restriction when
[creating a PackageInstaller session](https://android.googlesource.com/platform/frameworks/base/+/android-15.0.0_r1/services/core/java/com/android/server/pm/PackageInstallerService.java).
Plainphone lifts it only for that call, with a ten-second
recovery deadline, and restores it synchronously before writing or committing the APK.
A separate approved Play Store window can keep installs open until its own deadline or
install completion. A process restart closes both windows.

### Restoring the install restriction

| Trigger | What it covers |
| --- | --- |
| Before opening a window | Strong mode requires the battery exemption and waits for a foreground service to arm its watchdog. Plainphone commits the lease before clearing the restriction. Catalog requests also commit a daily slot before changing policy and refund it when the window fails to open. |
| Foreground deadline | The service requests recovery at the elapsed-time deadline even if the policy clear or session creation is still blocked. If a clear returns after expiry, the policy path reasserts the restriction. The service stops when no lease remains. |
| Session creation returns or throws | The restriction is restored synchronously in either case. A newly created session is abandoned if the restriction cannot be restored. |
| PackageInstaller result | Both success and failure close any matching session-bound lease left by an older build. A result for an older session cannot close a newer lease. |
| App start, boot, package replacement, or guard connection | Recovery closes abandoned windows and restores an unexpectedly lifted restriction. It preserves catalog quota across a restart. |
| Alarm and expiry work | An exact wake-up alarm is scheduled when permitted and canceled when its lease is retired. Otherwise, Plainphone uses an inexact alarm. Persistent WorkManager recovery also works offline. |
| Sync, update, enrollment, and policy runs | These check expired leases before ordinary work can skip the policy, including when the phone is unpaired, the update check is throttled, or the policy configuration is unchanged. |

The foreground service holds a bounded partial wake lock. The battery exemption lets
that lock work in Doze. On AOSP it also permits exact alarms independently of the
**Alarms & reminders** setting. Android persists the restriction as a boolean, so
recovery still depends on Android delivering an alarm or restarting the app after
process death and accepting its policy write. If an approved catalog window remains
active, the shared restriction stays lifted until that window ends.
Catalog targets can change within an active window and share its original deadline.
A request arriving while Android is clearing the restriction can be retried once that
call finishes. The watchdog can relock during the call, and recovery keeps the old
deadline until it can retire the window and record any observed delay. A later request
recovers a stale window before opening another one.

The ten-second self-update deadline is a recovery target. Android can suspend or kill
the process and delay the recovery triggers. During a delayed self-update window, a
child could attempt a separate install if they already had an APK ready and timed the
attempt to coincide with that window. Plainphone records a late relock when it happens
more than 30 seconds after the deadline, or when startup or boot recovers an expired
lease. The latest incident survives restarts and appears on the phone's dashboard page
and in the parent app after the next successful sync. Across a reboot, the delay is
estimated from the phone's wall clock. For older lease records without a wall-clock
deadline, recovery reports the incident with a zero-second lower bound because the
previous boot's elapsed clock cannot be compared with the new one.

See [Android's Doze documentation](https://developer.android.com/training/monitoring-device-state/doze-standby#support_for_other_use_cases)
and [AOSP's alarm permission handling](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-15.0.0_r1/apex/jobscheduler/service/java/com/android/server/alarm/AlarmManagerService.java).

### Checking for releases

WorkManager checks eligibility hourly over unmetered internet or while charging.
The two schedules share a 24-hour gate for automatic release checks. The dashboard's
**Update now** request bypasses that gate. Its direct connection reconnects with backoff
after transient failures, with rules sync as a fallback. Light mode shows an update
on the Today screen and sends a quiet notification when permitted. Installing the
offered version or a newer one clears the prompt.

## Real-phone release check

1. Deploy the server and dashboard with the additive phone update migration. Install the
   first self-updating build as described above, reapply the lock in strong mode, and
   confirm the dashboard sees its version.
2. Publish the next PATCH with a strictly higher version code, the same signing key and
   the matching metadata asset. Wait for the server cache to refresh. Check that
   `/download/android/latest.json` shows the new code and the APK hash.
3. Leave the phone locked, online and on unmetered Wi-Fi or charging. Wait for the daily
   WorkManager check (Android may defer background work). Confirm the dashboard reports
   the new installed version and Android again blocks ordinary app installation. This
   tests the automatic path without a PC, ADB, or a manual update on the phone.
   This also validates that the device accepts writes and commit after Plainphone
   restores the restriction, as expected from Android's session creation check.
4. On a phone still running the first self-updating build, request **Update now** in the
   dashboard. Confirm it updates through the direct connection or the next rules sync and that the restriction is
   restored. Repeat with an approved catalog install overlapping an update. Confirm Play
   closes when Plainphone restarts and that ordinary installation is blocked again.
5. On a test phone without the battery exemption, verify that strong-mode install
   requests leave the restriction in place. Enable the exemption, check recovery with
   **Alarms & reminders** already disabled, then repeat by revoking alarm access during a window. Record whether the restriction returns at
   the deadline when the screen is off or the process is killed. Check that restarting
   Plainphone recovers the restriction and keeps the used catalog slot.
6. In light mode, check that the newer version produces an update notification and that
   the installed version stays the same until the user chooses to install it.
