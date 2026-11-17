# Android updates

## First update on an already locked phone

On the phone, tap **Version** seven times. Enter the parent PIN and choose
**Lift the lock for 30 min**. Open Chrome, go to
`https://app.plainphone.org/download/android`, and download the APK. Allow Chrome to
install it if Android asks, then tap **Update**. Open Plainphone and choose **Lock now**.
The first build with self-update must use the same signing key as the installed app.
If the parent PIN screen shows **Allow install recovery alarms**, open it and allow
Plainphone under **Alarms & reminders**. Android may require lifting the lock first to
open Settings. On Android 12 and later, strong mode keeps installs blocked if it
cannot schedule the recovery alarm.

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
version code must also match the metadata. A shared policy leaves installs open while a valid
catalog or self-update window exists. Replacing Plainphone ends the self-update window
and preserves an approved Play Store window until its original deadline or install completion.

### Restoring the install restriction

| Trigger | What it covers |
| --- | --- |
| Before opening a window | Strong mode requires an exact elapsed-time alarm. Every window also queues persistent expiry work without a network constraint. If either step fails, Plainphone refuses the window. A refused catalog request does not use a daily slot. |
| PackageInstaller result | Both success and failure close the lease for that session, even if the original process is gone. A result for an older session cannot close a newer lease. |
| App start, boot, or package replacement | A restarted process recovers abandoned leases immediately. Reboot invalidates all leases. Package replacement invalidates the self-update lease and can preserve a still-valid catalog lease on the same boot. |
| Exact alarm and expiry work | The alarm targets the original deadline. The independent WorkManager job can recover the restriction if Doze delays the alarm or Android cancels it after exact-alarm access is revoked. It also works offline. |
| Sync, update, enrollment, and policy runs | These check expired leases before ordinary work can skip the policy, including when the phone is unpaired, the update check is throttled, or the policy configuration is unchanged. |

Android can defer alarms and WorkManager jobs. If Android prevents all app code from
running, the device policy cannot change until another recovery entry point runs. The
elapsed-time deadline is checked whenever Plainphone can run. If an approved catalog
window is still active, the shared restriction stays lifted until that window ends.
See [Android's alarm scheduling limits](https://developer.android.com/develop/background-work/services/alarms#exact-alarm-permission).

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
4. On a phone still running the first self-updating build, request **Update now** in the
   dashboard. Confirm it updates through the direct connection or the next rules sync and that the restriction is
   restored. Repeat with an approved catalog install overlapping an update. Confirm Play
   stays available after Plainphone restarts and the restriction returns once the catalog
   install finishes or its original window expires.
5. In strong mode, revoke **Alarms & reminders** during a test install and leave the
   phone offline. Confirm that the restriction returns through the installer result or
   expiry work. Repeat while the phone is idle and record when Android delivers recovery.
6. In light mode, check that the newer version produces an update notification and that
   the installed version stays the same until the user chooses to install it.
