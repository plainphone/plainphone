# Plainphone

Plainphone turns an ordinary Android phone into a calm phone: calls, messages, maps, music and the apps you actually need, without social media, endless feeds, games and porn. It is meant for a parent setting up a child's first phone, and for adults taking back their own attention.

> **Status: phase 4 core, the phone follows the parent's dashboard. Not for real use yet.**
> Phases 2 and 4 have not been tested on a real phone. Only install it on a spare test phone that you are ready to factory reset.

Plainphone is free and open source under the [Apache License 2.0](LICENSE). Maintained by Mahoje.

## What phase 1 does

The Android app in [`android/`](android) is a Device Policy Controller. It is set up by QR code on a factory-reset phone (Android 10 or newer; see [docs/android-versions.md](docs/android-versions.md)) and becomes **Device Owner**. It then:

- blocks app installs (Play Store and APK files), factory reset from Settings, safe mode, new users, guest mode, private space, app cloning, developer options and adb;
- forces private DNS (DNS-over-TLS) to a filtering resolver and stops the user from changing private DNS, VPN, network reset and user certificates;
- turns Chrome's own DNS-over-HTTPS and incognito mode off and forces SafeSearch;
- hides every app that is not on the allowlist: phone, messages, camera, clock, contacts, settings, keyboard and launcher (found per device, so Samsung and Xiaomi keep their own apps), plus Chrome, Maps, calculator, calendar and gallery;
- requires automatic date and time, blocks USB file transfer and SD cards, and blocks uninstalling Plainphone;
- optionally sets a Factory Reset Protection policy for chosen Google accounts.

A hidden maintenance screen protected by a parent PIN can lift the lock for a while, re-apply it, or release Device Owner completely, so a test phone never has to be thrown away.

## What phase 2 adds

- **Approved contacts.** Plainphone becomes the default phone and SMS app. Calls and SMS to and from numbers that are not on the list are blocked; hidden callers are rejected. 112, 911, 114 and the phone's own emergency numbers always work, and after an emergency call anyone can call back for an hour. A calm phone and messages app (Jetpack Compose, English and Danish) shows the approved contacts, recent calls, conversations and a keypad. Contacts come from the QR code and the maintenance screen. See [docs/contacts.md](docs/contacts.md).
- **DNS per phone.** The QR script can give each phone its own DNS-over-TLS address (`<id>.dns.plainphone.org`) on the Plainphone resolver (built in `dns/`).
- **DNS bypass analysis.** Which allowed apps could get around private DNS, and why an always-on VPN is the later layer: [docs/dns-bypass.md](docs/dns-bypass.md).

## What phase 4 adds

- **Pairing.** After the QR setup the phone shows a pairing code and QR code; the parent claims it in the dashboard ([`web/`](web)). The device token is sealed with a key in the Android Keystore. Pairing again later needs the maintenance PIN.
- **Rules from the server.** The phone fetches the parent's rules (WorkManager every 15 minutes, at boot and on network changes, every minute while the screen is on) and applies the app list, approved contacts, school time and bedtime, its own DNS address (only once the DNS service has confirmed it) and location. Offline, the last rules keep applying; an error never loosens anything.
- **Find.** When the parent presses Find, the phone sends one position (platform fused location, no Play services library). Only the latest position is kept.
- **Status.** Battery, last sync, app version and whether the lock is intact are shown in the dashboard.

See [docs/phone-sync.md](docs/phone-sync.md) for how it works and what is not done yet.

See [docs/policies.md](docs/policies.md) for every policy, what Android does not let us block, and links to the Android documentation.

## Documents

- [docs/setup-test-phone.md](docs/setup-test-phone.md): set up a test phone step by step, and how to get out again
- [docs/bypass-checklist.md](docs/bypass-checklist.md): every bypass attempt to test on a real phone, with the expected result
- [docs/policies.md](docs/policies.md): the policies and their known limits
- [docs/contacts.md](docs/contacts.md): approved contacts, emergency calls and what is not covered
- [docs/dns-bypass.md](docs/dns-bypass.md): how apps could get around the DNS filter
- [dns/](dns): the filtering DNS service (AdGuard Home + ppdns), its profiles and API; [docs/self-hosting-dns.md](docs/self-hosting-dns.md) runs your own, [docs/privacy.md](docs/privacy.md) says what it stores
- [site/](site): the plainphone.org landing page (static, no JavaScript)
- [server/](server) and [web/](web): the API and the parent web app (PWA); [docs/self-hosting.md](docs/self-hosting.md) runs your own, [docs/sync-api.md](docs/sync-api.md) is the phone's side of the API
- [docs/time-limits.md](docs/time-limits.md) and [docs/app-catalog.md](docs/app-catalog.md): daily time limits and the per-country app catalog
- [parent-app/](parent-app): the native parent app for iOS and Android (Expo) on the same API; [docs/parent-app.md](docs/parent-app.md) covers builds, app links and push
- [docs/phone-sync.md](docs/phone-sync.md): how the phone pairs, syncs and applies the rules; [scripts/e2e-phone-sync.sh](scripts/e2e-phone-sync.sh) tests the chain against the real server
- [SECURITY.md](SECURITY.md): how to report a bypass

## Build

Requirements: JDK 21 and the Android SDK (command-line tools are enough; Android Studio is not needed) with `platforms;android-37.0` and `build-tools;36.1.0`.

```sh
cd android
echo "sdk.dir=$ANDROID_HOME" > local.properties
./gradlew testDebugUnitTest lintDebug assembleDebug
```

The debug APK ends up in `android/app/build/outputs/apk/debug/`.

### Signing

No keys are stored in this repository. A release build reads its signing settings from a properties file outside the repository:

```properties
storeFile=/path/outside/the/repo/plainphone.jks
storePassword=...
keyAlias=...
keyPassword=...
```

```sh
PLAINPHONE_SIGNING=/path/to/signing.properties ./gradlew assembleRelease
```

Without `PLAINPHONE_SIGNING`, the release build is signed with your local debug key. The phase 1 pre-release APKs on GitHub are signed with a **test key** (certificate CN "Plainphone TEST key (not for production)"). Do not trust that key for anything except testing.

### QR code

```sh
scripts/provisioning-qr.py \
  --apk android/app/build/outputs/apk/release/app-release.apk \
  --apk-url https://github.com/plainphone/plainphone/releases/download/<tag>/<file>.apk \
  --ask-pin --out dist/provisioning-qr
```

The script reads the signing certificate checksum from the APK, asks for or generates the maintenance PIN (6+ digits), hashes it (PBKDF2; the PIN itself never goes into the QR code) and writes `dist/provisioning-qr.json` and `.png`. Run `scripts/provisioning-qr.py --help` for Wi-Fi, DNS host, extra apps and FRP accounts. A QR code with a Wi-Fi password in it must not be published.

Phase 2 options:

- `--dns-host '{id}.dns.plainphone.org'` gives the phone its own ClientID on the Plainphone resolver (`{id}` is replaced by `--dns-id`, or a new random ID). The ClientID must be registered on the DNS server first (`ppdns create child`, then pass the printed ID as `--dns-id`), otherwise the phone gets no DNS at all. The default is still `family.adguard-dns.com` until the resolver is live.
- `--contact 'Mum=+45 12 34 56 78'` (repeatable) and `--country-code 45` set the first approved contacts.

Phase 4 option:

- `--server-url https://your.server` points the phone at a self-hosted server (default `https://app.plainphone.org`). Once paired, the server registers the phone's own DNS ClientID and the phone switches to it by itself, so `--dns-host` can stay at the default.

## Roadmap

1. Proof of lock
2. **Contacts and DNS** (this phase): dialer/SMS role with an allowlist, own AdGuard Home with a DNS address per phone
3. Server and parent web app: accounts, pairing, rules, app list, location, school time
4. Light mode: the same app on a phone already in use, without a reset ([docs/light-mode.md](docs/light-mode.md)); time limits and an app catalog
5. Native parent apps
6. Self-hosting, plainphone.org and the public launch

## License

Apache License 2.0. See [LICENSE](LICENSE).
