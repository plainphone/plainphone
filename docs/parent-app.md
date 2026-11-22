# Parent app: builds, links and push

The native parent app lives in [`parent-app/`](../parent-app). This page covers what is needed around it: signing and store builds, the links that open the app, push notifications and running it against your own server.

## Identity

| | iOS | Android |
|---|---|---|
| Id | `org.plainphone.parent` for the App Store build (Plainphone Parent, `PLAINPHONE_BUNDLE_ID`); `org.plainphone.app` when it is unset | `org.plainphone.parent` |
| Team / signing | Apple team `P7698GU4AV` | Play App Signing, with an upload key |
| Minimum OS | Expo SDK 58 default | Expo SDK 58 default |

The same app will also be the iPhone app for a child's phone and an adult's own phone (roles
Parent, Child and Myself, `src/lib/roles.ts`). Only Parent is switched on today. While the
server pairs iPhones (`iosPairing` in `GET /me`), the phone list offers "Add an iPhone"
(`src/app/add-iphone.tsx`), which asks whose phone it is, lists Apple's prerequisites and goes on to
the pairing code. See [ios/architecture.md](ios/architecture.md).

## Login and other links

Login links for the app look like `https://app.plainphone.org/auth/app#token=…`. The app asks for them with `client: "native"` on `POST /api/auth/request`; the web app keeps getting `/auth/callback` links. The token sits in the URL fragment, so it never reaches a server log, and the app sends it with `POST /api/auth/verify` and `client: "native"` to get a session token. The session token is kept in the iOS Keychain or Android Keystore and sent as `Authorization: Bearer pp_s_…`. The app never uses cookies.

The store review address is the one exception to login links: on a server with
`REVIEW_LOGIN_EMAIL` and `REVIEW_LOGIN_CODE`, `POST /api/auth/request` answers that address with
`codeSignIn: true` and sends no mail, and the app shows a code field that signs in with
`POST /api/auth/review`. No other address ever sees it ([store-review.md](store-review.md)).

The app claims three paths on the server's host:

- `/auth/app`: login links
- `/pair?code=…`: the QR code a phone shows while pairing, so scanning it with the system camera opens the app
- `/invite#token=…`: invitations to a household

If the app is not installed, the same links open the web app, which handles all three. A login link for the app that opens in a browser anyway (in a mail app's own browser, or on Android before `ANDROID_APP_CERT_SHA256` is set) is not used up there: the page offers "Open in the app" (`plainphone://auth/app#token=…`) or "Log in here".

A login link that someone else sends would sign the app or browser into their account. A parent who then adds a phone would give that account the child's phone. So the app and the web app use a login link straight away only when they asked for it themselves in the last 15 minutes (the link's lifetime). Any other link, or a link opened while someone is signed in, first asks "Log in with this link?" and names the signed-in account. When a link replaces a session in the app, the app ends the old session on the server.

An invitation to a household always waits for the parent to tap **Join the household**, also when it was kept across the login. Only the e-mail address the invitation was sent to can accept it. Signed in with another address, the app says so and offers **Sign out and continue**, which signs out and keeps the invitation link for the next login. New phones go to the household the Household page shows, with an explicit `householdId`. A parent in more than one household gets a picker on the Household and Summary screens (and in the weekly summary settings); the choice is kept on the device and defaults to the first household in `/api/me`. The web dashboard works the same.

Logging out ends the session on the server, which also removes the device's push registrations. The web dashboard stays signed in and says so when the server can't be reached, because only the server can end its HttpOnly cookie. The app always signs out locally. If the server can't be reached, the app keeps the token and tries again at every start until the server confirms. Switching to another server ends the session on the old server the same way. Logging out also forgets the page to return to and any invitation kept for the login, except with **Sign out and continue** on an invitation sent to another address, which keeps that one link.

The server publishes the association files:

- `GET /.well-known/apple-app-site-association` lists `APPLE_APP_IDS` (default `P7698GU4AV.org.plainphone.app`). Update any explicit override that still points to the old iOS bundle ID.
- The App Store build of the parent app (Plainphone Parent) is built with `PLAINPHONE_BUNDLE_ID=org.plainphone.parent`. A server that serves it lists both apps, `APPLE_APP_IDS=P7698GU4AV.org.plainphone.app,P7698GU4AV.org.plainphone.parent`, and sends its push with `APNS_BUNDLE_ID=org.plainphone.parent`. Both `deploy/dokploy-compose.yaml` and the self-hosting `compose.yaml` pass `APPLE_APP_IDS`, `ANDROID_APP_PACKAGE` and `ANDROID_APP_CERT_SHA256` through to the app.
- `GET /.well-known/assetlinks.json` lists `ANDROID_APP_PACKAGE` (default `org.plainphone.parent`) with the certificate fingerprints in `ANDROID_APP_CERT_SHA256`. It is an empty list until a fingerprint is set.

For Android app links to verify, `ANDROID_APP_CERT_SHA256` must hold the SHA-256 fingerprint of every certificate that signs a build people install: the Play App Signing key (shown in Play Console under Test and release > App integrity), and optionally the upload key for builds installed outside Play. Separate several with commas.

The paths are listed twice, in `parent-app/app.config.ts` and in `APP_LINK_PATHS` in `server/src/app.ts`. Change both together.

## Push notifications

The app registers directly with the Plainphone server for APNs on iOS or FCM on Android. Enable permission under **Settings → Notifications**. The app sends a granted token on sign-in and refresh, and registers a replacement when the OS rotates it. Android uses the **Notifications** and **Urgent SOS** channels. Tapping an alert can open a phone, its location, approvals or settings.

Per-phone alert preferences are shared with the web dashboard. **Mute** for a phone quiets the push
and the mail for quick messages, check-ins, suggestions from the child, requests and the "review the
rules" reminder; each still appears in the inbox or on the dashboard. SOS, code words and "protection
removed" alerts always come through. See [push setup](push-setup.md) for the Firebase and Apple configuration.

SOS alerts use the same registration. An urgent SOS is sent as a high-priority alert on the
**Urgent SOS** channel (Android) or as a time-sensitive notification (iOS), and both SOS kinds
open the child phone's overview. In system settings, allow Urgent SOS through Do Not Disturb or
Focus if your phone offers it. See [SOS](sos.md#push-configuration).

## Live updates

While the app is in the foreground it keeps a live connection to the server (`GET /api/events`)
and refreshes the open screen when something happens: an SOS (a banner on every screen, with a
vibration), a request or its answer, a new position, an inbox message or a status change. React
Native's fetch cannot stream, so the app reads the stream with `XMLHttpRequest`
(`src/lib/live-transport.ts`); no extra package. The connection closes when the app goes to the
background, where push takes over, and resumes or refetches when it comes back. **Settings → Live
updates** and **SOS alert** switch it off per device. See [live updates](live-updates.md).

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

Enable Associated Domains (`applinks:app.plainphone.org`), Push Notifications and Time Sensitive Notifications for the App ID in the Apple developer account. The `expo-notifications` plugin adds the `aps-environment` entitlement. Add `-allowProvisioningUpdates` to both `xcodebuild` calls to let Xcode refresh the provisioning profile.

The privacy manifest (`ios.privacyManifests` in `app.config.ts`) declares the sign-in email address, a number to call back (check-ins, SOS), the approved contacts a parent enters for a phone and the content a parent writes (phone names, rules, messages, requests) as collected, linked to the account, used only for the app's function and never for tracking, as described in [privacy.md](privacy.md). Keep it, the App Store privacy answers and privacy.md in step.

EAS Build is optional for compiling and signing. Push does not need an Expo account: the app registers its APNs or FCM token with your server.

The iOS build links the local Expo module `modules/plainphone-screentime` (Family Controls,
ManagedSettings, DeviceActivity). The Parent role never calls it. Its Swift bridge file is only
compiled by an Expo build, not by CI, so build once on a Mac after changing it. A build with
`PLAINPHONE_IOS_CHILD=1` also offers the Child role ("Whose phone is this?" on the first launch,
then the setup on the iPhone) on iPhones with iOS 26 or later, checked at run time; parents on
older iPhones (from iOS 16.4) get the same build as Parent only. The Child role needs the Family
Controls entitlement and the App Group
`group.org.plainphone.app`, and the extension targets are not part of the Expo build yet
([docs/ios/architecture.md](ios/architecture.md#what-exists-now-phase-1-skeleton)). Leave it off for
App Store builds until phase 1 has run on a real iPhone.

## Your own server

Select **Use your own server** on the sign-in screen or in Settings, enter the HTTPS origin
(e.g. `https://plainphone.example.org`), and select **Connect**. The app checks
`/api/health` for `ok: true` and `compatibility: 1` before saving the address.
Changing servers ends the session on the old server, and you sign in again. Select **Use plainphone.org**
to return to the hosted service. If the sign-in link opens your browser, choose **Open in the app**
from the page served by your server.

For an existing phone, **Allow moving this phone to another server** is on the phone overview.
Enable it before exporting the phone. A Myself phone needs its key. Use the web dashboard on
both servers to download and import the encrypted file and start the
[move](self-hosting.md#move-to-your-own-server).

Native notification registration goes to the selected server when you enable notifications
in Settings. When you reopen Settings, the app checks whether this device's APNs or FCM
token is still registered for your account on that server. Older servers without the status
endpoint may ask you to enable notifications again. The built-in server provider delivers
Web Push to the dashboard and stores native tokens for future delivery.

To set a custom default and have the OS open your domain's links directly, build with
your own address and app identifiers:

```sh
PLAINPHONE_SERVER_URL=https://plainphone.example.org \
PLAINPHONE_BUNDLE_ID=org.example.plainphone \
PLAINPHONE_ANDROID_PACKAGE=org.example.plainphone.parent \
PLAINPHONE_APPLE_TEAM_ID=ABCDE12345 \
npx expo prebuild
```

and set on the server: `APPLE_APP_IDS=ABCDE12345.org.example.plainphone`, `ANDROID_APP_PACKAGE=org.example.plainphone.parent` and `ANDROID_APP_CERT_SHA256=<your signing certificate's SHA-256>`.
For a custom iOS build that uses APNs, also set `APNS_BUNDLE_ID=org.example.plainphone`.
`PLAINPHONE_BUNDLE_ID` controls iOS. For Android test builds previously using that variable,
move the package override to `PLAINPHONE_ANDROID_PACKAGE`.
