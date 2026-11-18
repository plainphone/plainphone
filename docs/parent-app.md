# Parent app: builds, links and push

The native parent app lives in [`parent-app/`](../parent-app). This page covers what is needed around it: signing and store builds, the links that open the app, push notifications and running it against your own server.

## Identity

| | iOS | Android |
|---|---|---|
| Id | `org.plainphone.parent` | `org.plainphone.parent` |
| Team / signing | Apple team `P7698GU4AV` | Play App Signing, with an upload key |
| Minimum OS | Expo SDK 58 default | Expo SDK 58 default |

## Login and other links

Login links for the app look like `https://app.plainphone.org/auth/app#token=…`. The app asks for them with `client: "native"` on `POST /api/auth/request`; the web app keeps getting `/auth/callback` links. The token sits in the URL fragment, so it never reaches a server log, and the app sends it with `POST /api/auth/verify` and `client: "native"` to get a session token. The session token is kept in the iOS Keychain or Android Keystore and sent as `Authorization: Bearer pp_s_…`. The app never uses cookies.

The app claims three paths on the server's host:

- `/auth/app`: login links
- `/pair?code=…`: the QR code a phone shows while pairing, so scanning it with the system camera opens the app
- `/invite#token=…`: invitations to a household

If the app is not installed, the same links open the web app, which handles all three. A login link for the app that opens in a browser anyway (in a mail app's own browser, or on Android before `ANDROID_APP_CERT_SHA256` is set) is not used up there: the page offers "Open in the app" (`plainphone://auth/app#token=…`) or "Log in here".

The server publishes the association files:

- `GET /.well-known/apple-app-site-association` lists `APPLE_APP_IDS` (default `P7698GU4AV.org.plainphone.parent`).
- `GET /.well-known/assetlinks.json` lists `ANDROID_APP_PACKAGE` (default `org.plainphone.parent`) with the certificate fingerprints in `ANDROID_APP_CERT_SHA256`. It is an empty list until a fingerprint is set.

For Android app links to verify, `ANDROID_APP_CERT_SHA256` must hold the SHA-256 fingerprint of every certificate that signs a build people install: the Play App Signing key (shown in Play Console under Test and release > App integrity), and optionally the upload key for builds installed outside Play. Separate several with commas.

The paths are listed twice, in `parent-app/app.config.ts` and in `APP_LINK_PATHS` in `server/src/app.ts`. Change both together.

## Push notifications

The Android parent app receives Firebase Cloud Messaging (FCM) notifications when
a rule change is waiting for a trusted person's approval. Tapping the notification
opens the approvals list. The message carries generic text and an event type,
without phone names, contact details or location. The existing test-notification
endpoint can also send to FCM. In the native app, open Settings and allow
notifications to register the device token directly with your Plainphone server.

### Android build

The Firebase project is `plainphone`, and its Android app is `org.plainphone.parent`.
The build needs that app's `google-services.json` from Firebase Project settings.
For a local build, retrieve the file from Bitwarden item
`Firebase Plainphone (plainphone) google-services.json` and save it as
`parent-app/google-services.json`. Git ignores this path.

For EAS, open the parent app project in the Expo dashboard, go to Environment
variables, upload the JSON as a **File** named `GOOGLE_SERVICES_JSON`, set visibility
to **Secret**, and select the environment used by the Android build profile
(for example, `production`). EAS supplies the uploaded file's path to
`android.googleServicesFile`. The app also builds without the file and logs a
warning that Android push is disabled.
[Expo file-variable setup](https://docs.expo.dev/eas/environment-variables/manage/#secrets-and-file-variables)

For a self-hosted build with a custom `PLAINPHONE_BUNDLE_ID`, register that Android
package in your Firebase project and use its corresponding file.

### Server

Set `FCM_SERVICE_ACCOUNT_JSON` on the server, for example in the Dokploy app's
Environment settings or in the self-hosted Compose `.env`. Use a service-account
key JSON for the same Firebase project as the Android build. For an env editor
that expects a single line, use base64 of the whole JSON file. Treat it as a
server secret. Enable the Firebase Cloud Messaging API for the project and give
the service account permission to send messages, for example with the Firebase
Cloud Messaging API Admin role. If the env variable is empty, FCM is off and
the server logs one warning at startup. Web Push uses its existing VAPID
configuration independently.
[Firebase HTTP v1 setup](https://firebase.google.com/docs/cloud-messaging/send/v1-api)

With system notification permission already granted, the app registers the current
native token after sign-in and when it returns to the foreground. The server
binds each native registration to the session that created it. Token rotation
replaces that session's previous token for the same platform. Signing out or
switching accounts with a login link ends the previous session and removes its
native registrations. The app keeps the session for retry if the logout request
fails. An expired session stops receiving notifications immediately, and the
server removes its registrations when it sweeps the session. Existing native
registrations resume delivery after the app registers again. Browser Web Push
remains independent of the session.

FCM tokens are removed on Firebase's token-specific `UNREGISTERED` (HTTP 404)
response. Other failures keep the subscription.

TODO for iOS delivery: the app registers APNs tokens, and the server stores
them. Add an APNs implementation of `NativeParentPushProvider` and wire it into
notification dispatch alongside FCM. Document APNs credentials and environment
selection when adding it. Native location notifications are also outside the
current delivery scope.

## Location screen

The screen mirrors the PWA's location page, section by section, with the same copy (`loc.*`, `ring.*` and `checkin.*` come from `web/src/i18n` through `pnpm sync:shared`):

1. **Last known position**: when ("5 minutes ago"), the date, how accurate, the map, and Find. Under it, "Drive there" with Apple Maps and Google Maps (Apple first on iOS, Google first on Android) and "Copy position" (`lat, lon` with six decimals).
2. **Ring the phone**: start, an option to keep ringing for the full 5 minutes, a live status (waiting, ringing with the time left, "I'm here" pressed, stopped, nobody answered) and "Stop the sound".
3. **Are you okay?**: 5, 10, 15 or 30 minutes, which approved contact the "Call me" button calls (or none), a live status, and cancel while it waits.
4. **Location sharing**: the four modes (`off`, `find`, `checkin`, `always`) as radio choices with an explanation each.

While a ring or a question is open (or an unanswered question still waits for its position), the screen reads `GET /phones/{pid}/location` every 5 seconds. Screen readers are told when the situation changes, not on every tick of the countdown.

### Map

The last position is drawn on OpenStreetMap raster tiles, fetched straight from `tile.openstreetmap.org`: nine plain images around the position, a marker and the accuracy circle drawn on top. The zoom level (12 to 17) follows the accuracy so that the circle fits; raster tiles only exist at whole zoom levels, so unlike the PWA's map it does not zoom smoothly or pan. The map is off until the parent taps Show map (the choice is kept on the device), and the screen says why. No map SDK or API key is needed. Loading the tiles tells the OpenStreetMap servers roughly which area is being looked at. The app sends no other data to third parties.

The PWA uses OpenFreeMap (`tiles.openfreemap.org`). It serves vector tiles only, which need a map SDK to draw (MapLibre Native, a new native module), so the app keeps the OpenStreetMap raster tiles. They are used as the tile usage policy asks: the app sends its own `User-Agent`, nothing is prefetched or saved for offline use, and tiles are only requested while the parent looks at the map. If the app ever grows beyond light use, switch to a provider with a key or host your own tiles, and change `tileUrl` in `parent-app/src/lib/tiles.ts` and the text in `native.mapPrivacy`.

"Copy position" opens the system share sheet, which has a Copy action on iOS and Android, because the app has no clipboard module. Adding `expo-clipboard` would make it a one-tap copy; it needs a new native build, so it is left out for now (`parent-app/src/lib/clipboard.ts` is the only place to change).

## Building

### Android (local, no Expo account)

```sh
cd parent-app
pnpm install
npx expo prebuild --platform android
cd android
./gradlew assembleRelease \
  -Pandroid.injected.signing.store.file=/path/to/upload.jks \
  -Pandroid.injected.signing.key.alias=upload
# passwords: ORG_GRADLE_PROJECT_android.injected.signing.store.password and ...key.password,
# or a gradle.properties outside the repo; never on the command line in shared logs
./gradlew bundleRelease   # the .aab for Play
```

Needs JDK 21 and the Android SDK (`ANDROID_HOME`); Gradle downloads the NDK and CMake it needs on the first build.

### iOS (needs a Mac)

On a Mac with Xcode:

```sh
cd parent-app
pnpm install
npx expo prebuild --platform ios
cd ios && pod install && cd ..
xcodebuild -workspace ios/Plainphone.xcworkspace -scheme Plainphone -configuration Release \
  -archivePath build/Plainphone.xcarchive -destination 'generic/platform=iOS' archive \
  DEVELOPMENT_TEAM=P7698GU4AV
xcodebuild -exportArchive -archivePath build/Plainphone.xcarchive -exportPath build \
  -exportOptionsPlist ExportOptions.plist   # method app-store-connect
```

Two capabilities must be enabled on the App ID in the Apple developer account, or signing fails: Associated Domains (`applinks:app.plainphone.org`) and Push Notifications (the `expo-notifications` plugin adds the `aps-environment` entitlement). Add `-allowProvisioningUpdates` to both `xcodebuild` calls to let Xcode refresh the provisioning profile.

EAS Build would do both in the cloud, but needs an Expo account; the project does not depend on one.

## Your own server

Build the app with your server and ids:

```sh
PLAINPHONE_SERVER_URL=https://plainphone.example.org \
PLAINPHONE_BUNDLE_ID=org.example.plainphone \
PLAINPHONE_APPLE_TEAM_ID=ABCDE12345 \
npx expo prebuild
```

and set on the server: `APPLE_APP_IDS=ABCDE12345.org.example.plainphone`, `ANDROID_APP_PACKAGE=org.example.plainphone` and `ANDROID_APP_CERT_SHA256=<your signing certificate's SHA-256>`.
