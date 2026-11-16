# Plainphone

Plainphone turns an ordinary Android phone into a calm phone: calls, messages, maps, music and the apps you actually need, without social media, endless feeds, games and porn. It is meant for a parent setting up a child's first phone, and for adults taking back their own attention.

> **Status: phase 1, proof of lock. Not for real use yet.**
> This phase only proves that the lock holds on a real phone. There is no server, no parent app and no contact filter yet. Only install it on a spare test phone that you are ready to factory reset.

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

See [docs/policies.md](docs/policies.md) for every policy, what Android does not let us block, and links to the Android documentation.

## Documents

- [docs/setup-test-phone.md](docs/setup-test-phone.md): set up a test phone step by step, and how to get out again
- [docs/bypass-checklist.md](docs/bypass-checklist.md): every bypass attempt to test on a real phone, with the expected result
- [docs/policies.md](docs/policies.md): the policies and their known limits
- [site/](site): the plainphone.org landing page (static, no JavaScript)
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

## Roadmap

1. **Proof of lock** (this phase)
2. Contacts and DNS: dialer/SMS role with an allowlist, own AdGuard Home with a DNS address per phone
3. Server and parent web app: accounts, pairing, rules, app list, location, school time
4. Light mode: a Play Store app for phones already in use
5. Native parent apps
6. Self-hosting, plainphone.org and the public launch

## License

Apache License 2.0. See [LICENSE](LICENSE).
