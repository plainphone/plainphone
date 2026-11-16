# Plainphone

Plainphone turns an ordinary Android phone into a calm phone: calls, messages, maps, music and the apps you actually need, without social media, endless feeds, games and porn. It is meant for a parent setting up a child's first phone, and for adults taking back their own attention.

> **Status: phase 2, approved contacts and DNS filter. Not for real use yet.**
> Phase 2 has not been tested on a real phone. The server and parent web app ([`server/`](server), [`web/`](web)) are built, but phones do not use them yet. Only install it on a spare test phone that you are ready to factory reset.

Plainphone is free and open source under the [Apache License 2.0](LICENSE). Maintained by Mahoje.

## What phase 1 does

The Android app in [`android/`](android) is a Device Policy Controller. It is set up by QR code on a factory-reset phone (Android 14 or newer) and becomes **Device Owner**. It then:

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

See [docs/policies.md](docs/policies.md) for every policy, what Android does not let us block, and links to the Android documentation.

## Documents

- [docs/setup-test-phone.md](docs/setup-test-phone.md): set up a test phone step by step, and how to get out again
- [docs/bypass-checklist.md](docs/bypass-checklist.md): every bypass attempt to test on a real phone, with the expected result
- [docs/policies.md](docs/policies.md): the policies and their known limits
- [docs/contacts.md](docs/contacts.md): approved contacts, emergency calls and what is not covered
- [docs/dns-bypass.md](docs/dns-bypass.md): how apps could get around the DNS filter
- [site/](site): the plainphone.org landing page (static, no JavaScript)
- [server/](server) and [web/](web): the API and the parent web app (PWA); [docs/self-hosting.md](docs/self-hosting.md) runs your own, [docs/sync-api.md](docs/sync-api.md) is the phone's side of the API
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

- `--dns-host '{id}.dns.plainphone.org'` gives the phone its own ClientID on the Plainphone resolver (`{id}` is replaced by `--dns-id`, or a new random ID). Register the ClientID on the DNS server before setting up the phone. The default is still `family.adguard-dns.com` until the resolver is live.
- `--contact 'Mum=+45 12 34 56 78'` (repeatable) and `--country-code 45` set the first approved contacts.

## Roadmap

1. Proof of lock
2. **Contacts and DNS** (this phase): dialer/SMS role with an allowlist, own AdGuard Home with a DNS address per phone
3. Server and parent web app: accounts, pairing, rules, app list, location, school time
4. Light mode: a Play Store app for phones already in use
5. Native parent apps
6. Self-hosting, plainphone.org and the public launch

## License

Apache License 2.0. See [LICENSE](LICENSE).
