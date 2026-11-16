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

If the app is not installed, the same links open the web app, which handles all three.

The server publishes the association files:

- `GET /.well-known/apple-app-site-association` lists `APPLE_APP_IDS` (default `P7698GU4AV.org.plainphone.parent`).
- `GET /.well-known/assetlinks.json` lists `ANDROID_APP_PACKAGE` (default `org.plainphone.parent`) with the certificate fingerprints in `ANDROID_APP_CERT_SHA256`. It is an empty list until a fingerprint is set.

For Android app links to verify, `ANDROID_APP_CERT_SHA256` must hold the SHA-256 fingerprint of every certificate that signs a build people install: the Play App Signing key (shown in Play Console under Test and release > App integrity), and optionally the upload key for builds installed outside Play. Separate several with commas.

The paths are listed twice, in `parent-app/app.config.ts` and in `APP_LINK_PATHS` in `server/src/app.ts`. Change both together.

## Push notifications

The app is ready for two notifications: a change waiting for your approval, and a position that is ready after Find. It asks for permission in Settings, creates the Android channels `approval` and `location`, and reads the native device token (APNs or FCM). It does not use the Expo push service.

Still missing before notifications arrive:

1. An APNs key (`.p8`) from the Apple developer account and a Firebase project for FCM, with `google-services.json` added to the Android build (`android.googleServicesFile` in `app.config.ts`).
2. A server endpoint where the app registers its token, and a push provider in `server/src/providers/push.ts` that sends through APNs and FCM.
3. The payload the app already understands: `data: { type: "approval" | "location", phoneId?: "<uuid>" }`. Tapping it opens the phone (or the approvals list) or the phone's location.

## Map

The location screen can draw the last position on OpenStreetMap raster tiles, fetched straight from `tile.openstreetmap.org`. The map is off until the parent taps Show map (the choice is kept on the device), and the screen says why. No map SDK or API key is needed. Loading the tiles tells the OpenStreetMap servers roughly which area is being looked at, the same as opening the "Open in Maps" link. The app sends no other data to third parties.

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

On a Mac with Xcode (the self-hosted runner `mahope-mac` has one):

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

The Associated Domains capability (`applinks:app.plainphone.org`) must be enabled on the App ID in the Apple developer account, or signing fails.

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
