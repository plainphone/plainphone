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

The server sends notifications to the app straight through APNs (iOS) and FCM (Android); the Expo push service is not used. The same events go to the web app through Web Push: protection removed on a phone, a phone offline for long, and something waiting for your approval.

How it fits together:

1. When you turn on notifications in Settings, the app reads the native device token and registers it with `POST /api/notifications/subscriptions` (`platform: "apns"` or `"fcm"`). It registers again at every start while signed in and when the system issues a new token, and removes it with `DELETE /api/notifications/subscriptions/{id}` when you log out.
2. The payload carries `url` (a path in the app: `/phones/<id>`, `/phones/<id>/location`, `/approvals` or `/settings`) and `channel`, the Android notification channel: `alerts` (high importance), `approval` or `location`. Tapping opens `url`; other paths open the start screen.
3. Tokens APNs or FCM reject for good (unregistered, wrong app) are deleted on the server.

What the server needs (see [self-hosting.md](self-hosting.md)):

- **Android:** a Firebase project with an Android app for the package name. Build the app with its `google-services.json` (`GOOGLE_SERVICES_JSON=/path/to/google-services.json npx expo prebuild`; the file is never committed), and give the server a service account key of the same project in `FCM_SERVICE_ACCOUNT_JSON` (Firebase console > Project settings > Service accounts > Generate new private key; base64 of the JSON is easiest in an env file). The Firebase project can stay on the free plan.
- **iOS:** an APNs auth key (`.p8`) from the Apple developer account (Certificates, Identifiers & Profiles > Keys, with Apple Push Notifications service) in `APNS_KEY_P8` and its id in `APNS_KEY_ID`. Team and bundle id come from `APPLE_APP_IDS`. TestFlight and App Store builds use `APNS_ENVIRONMENT=production` (the default); builds run from Xcode use `sandbox`.

Without these, the app still registers its token; notifications start once the keys are set. `GET /api/notifications` reports `nativePush: { apns, fcm }`.

## Map

The location screen can draw the last position on OpenStreetMap raster tiles, fetched straight from `tile.openstreetmap.org`. The map is off until the parent taps Show map (the choice is kept on the device), and the screen says why. No map SDK or API key is needed. Loading the tiles tells the OpenStreetMap servers roughly which area is being looked at, the same as opening the "Open in Maps" link. The app sends no other data to third parties.

## Building

### Android (local, no Expo account)

```sh
cd parent-app
pnpm install
GOOGLE_SERVICES_JSON=/path/to/google-services.json npx expo prebuild --platform android   # for FCM push
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

Two capabilities must be enabled on the App ID in the Apple developer account, or signing fails: Associated Domains (`applinks:app.plainphone.org`) and Push Notifications (the `expo-notifications` plugin adds the `aps-environment` entitlement).

What worked for the hosted app (17/11-2026, Xcode 27.2): manual signing with an App Store provisioning profile, set on the app target only. Overriding signing for the whole build breaks the CocoaPods targets, and automatic signing wants a development profile, which needs registered devices.

1. Create an App Store profile for the App ID and your Apple Distribution certificate (in the developer portal, or with the App Store Connect API) and install it in `~/Library/MobileDevice/Provisioning Profiles`.
2. In `ios/<App>.xcodeproj/project.pbxproj`, give the app target's Release configuration `CODE_SIGN_STYLE = Manual`, `PROVISIONING_PROFILE_SPECIFIER = <profile uuid>` and `"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "Apple Distribution"`.
3. Archive with `-sdk iphoneos` (add `OTHER_CODE_SIGN_FLAGS="--keychain <keychain>"` when the certificate is in a separate keychain), then export with an `ExportOptions.plist` holding `method` `app-store-connect`, `signingStyle` `manual`, `teamID`, `signingCertificate` `Apple Distribution` and `provisioningProfiles` `{ <bundle id>: <profile uuid> }`.

If `codesign` fails with `errSecInternalComponent`, another keychain in the search list holds the same identity but is locked; put the keychain with the certificate first (`security list-keychains -d user -s …`) for the build.

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
