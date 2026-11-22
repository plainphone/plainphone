# F-Droid for the phone app

**Short answer: realistic, and a better fit than Play for the phone app's alpha.** The default
build has no proprietary dependencies, the source is Apache-2.0, and the server is open source
and self-hostable. What is missing is a FOSS release build that we publish ourselves and that
F-Droid can reproduce byte for byte, so every channel has one signature.

The parent app is not a candidate yet: Expo builds are hard to reproduce, and its Android push
uses Firebase. The web dashboard covers parents without Google.

## Why reproducible, and signed by us

Android only updates an app in place with the same signing key. F-Droid normally signs with its
own key, which would make an F-Droid install and a GitHub APK two incompatible apps: a family
could not move between them without uninstalling, and a strong-mode phone cannot uninstall
Plainphone at all. Strong-mode QR codes also pin the signing certificate's checksum
([README](../../README.md#signing)).

F-Droid's [reproducible builds](https://f-droid.org/docs/Reproducible_Builds/) solve this: F-Droid
builds from source, compares the result with our signed APK, and if they match it publishes **our**
APK with our signature. The recipe then lists the certificate in `AllowedAPKSigningKeys`.

## What the build needs

1. **A FOSS release APK.** Official APKs are built with `-PplainphoneFcm=true`
   ([push-setup.md](../push-setup.md)), which adds Firebase Cloud Messaging. F-Droid will not
   build that ("NonFreeDep"). The default build (no FCM, no Play Billing) is already free:
   Compose, AndroidX, WorkManager, Tink, Gson and json-canonicalization, all under open licences.
   It wakes up through UnifiedPush or polling. So each release would also publish
   `plainphone-VERSION-foss.apk`, built without `-PplainphoneFcm` and `-PplainphonePlay`, signed
   with the production key.
2. **Determinism.** Things to check, by building the same tag twice on two machines and
   comparing with `diffoscope` or F-Droid's `apksigcopier`:
   - `dependenciesInfo` is already off for APK and bundle (F-Droid requires this).
   - VCS info: AGP writes `META-INF/version-control-info.textproto` for release builds; turn it
     off (`vcsInfo { include = false }`) or make sure it only holds the commit.
   - Baseline profile (`assets/dexopt/baseline.prof`) and R8 output must be stable with the
     pinned AGP (9.5.1) and JDK 17.
   - The build reads `server/catalog/helplines` from outside `android/`; F-Droid checks out the
     whole repository, so this works if the recipe's `subdir` is `android/app`.
3. **No binaries in the source.** `git ls-files` lists only `android/gradle/wrapper/gradle-wrapper.jar`,
   which F-Droid accepts after checking its checksum. The MLS library (`e2ee/`) is built only for
   debug builds with a flag and never goes into a release.
4. **The self-updater.** F-Droid's client updates the app, and reviewers usually ask for an
   in-app updater to be off in F-Droid builds. Light mode only offers an update when the server
   has metadata, so a build property that turns the check off is small. Strong mode is different:
   F-Droid cannot install updates while `DISALLOW_INSTALL_APPS` is set, so strong-mode phones keep
   updating themselves from GitHub Releases, with the same key. Say this plainly in the F-Droid
   description.
5. **SDK.** The app compiles against API 37. F-Droid's build server must have that platform;
   check before submitting.

## Metadata

F-Droid reads `fastlane/metadata/android/<locale>/` from the repository. The texts there today
are written for the **Play edition** (light mode, Child profile, no APK links), which is narrower
than what an F-Droid build can do. Two options:

- keep F-Droid's own texts in `fdroiddata` (`metadata/org.plainphone.app/<locale>/`), describing
  both modes and the Myself profile; confirm with the F-Droid reviewers that these override the
  repository's files, or
- move the Play texts to `fastlane/play/` once the F-Droid listing exists, and let
  `fastlane/metadata/android/` describe the full app.

Screenshots for F-Droid go in `fastlane/metadata/android/<locale>/images/phoneScreenshots/`; F-Droid
has no fixed aspect ratio, so the existing 1179×2556 renders fit as they are
([screenshots.md](screenshots.md)).

## Anti-features

With the FOSS build none should apply: no ads, no tracking, no proprietary dependency, and the
default server (`app.plainphone.org`) runs open source code anyone can host
([self-hosting.md](../self-hosting.md)), so "NonFreeNet" does not apply. F-Droid reviewers may
still discuss "Tracking" because the app reports position and app use to parents; the answer is
that this is the app's visible purpose, disclosed in the description, and never sent to us for
any other use.

## Draft recipe (`fdroiddata/metadata/org.plainphone.app.yml`)

```yaml
Categories:
  - Phone & SMS
  - System
License: Apache-2.0
SourceCode: https://github.com/plainphone/plainphone
IssueTracker: https://github.com/plainphone/plainphone/issues
WebSite: https://plainphone.org/

RepoType: git
Repo: https://github.com/plainphone/plainphone.git

Builds:
  - versionName: 0.1.20
    versionCode: 21
    commit: v0.1.20
    subdir: android/app
    gradle:
      - yes
    binary: https://github.com/plainphone/plainphone/releases/download/v%v/plainphone-%v-foss.apk

AllowedAPKSigningKeys: <SHA-256 of the production certificate, from the README>

AutoUpdateMode: Version
UpdateCheckMode: Tags ^v[0-9.]+$
CurrentVersion: 0.1.20
CurrentVersionCode: 21
```

The version numbers are an example: the first release with a FOSS APK. Submit as a merge request
to `fdroiddata` on GitLab; the inclusion review usually takes weeks.
