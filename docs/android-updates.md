# Android updates

## First update on an already locked phone

On the phone, tap **Version** seven times. Enter the parent PIN and choose
**Lift the lock for 30 min**. Open Chrome, go to
`https://app.plainphone.org/download/android`, and download the APK. Allow Chrome to
install it if Android asks, then tap **Update**. Open Plainphone and choose **Lock now**.
The first build with self-update must use the same signing key as the installed app.

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
catalog or self-update window exists. The update window closes when the session ends.
An elapsed-time alarm, the next process start, and the boot/package-replaced broadcasts
cover interrupted and expired windows. Light mode shows an update on the Today screen and sends a quiet notification when permitted.

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
   restored. Repeat with an approved catalog install overlapping an update if available.
5. In light mode, check that the newer version produces an update notification and that
   the installed version stays the same until the user chooses to install it.
