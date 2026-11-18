# Plainphone and Google Play Protect

Research date: 18 November 2026. Scope: the reported browser install of Plainphone v0.1.9 from app.plainphone.org, the manifest in this checkout, and public documentation. **Documented** means a primary source describes the behavior. **Assessment** means an inference about Plainphone. Living pages without a visible publication date are marked with the access date. The exact release APK and installation routes were not tested on a phone.

## 1. What blocked the browser install?

**Assessment (high confidence): Enhanced Fraud Protection (EFP).** Google's developer guide reproduces the reported financial-fraud warning, including its reference to identity theft, in the section on blocking internet-sideloaded apps. The browser context and Plainphone's manifest match the documented rule. The generic Android icon offers no independent evidence about the verifier's decision. Google documents the same wording for unapproved Device Policy Controllers (DPCs) during enrollment, so the installation context matters. A potentially harmful application (PHA) classification and an unknown-app scan prompt have separate descriptions. The reported dialog alone cannot establish a PHA verdict or identify which declaration caused the browser block. [Google Play Protect warning guidance, updated 18 August 2026][warnings]

**Documented:** EFP automatically blocks installs from covered internet sources such as browsers, messaging apps and file managers when the app declares any of Google's listed signals. The check occurs at installation, before a user grants access or chooses a Plainphone mode. [Google's original pilot announcement, February 2024][pilot] · [Google warning guidance, 18 August 2026][warnings]

| Documented EFP signal | Plainphone manifest in this checkout |
| --- | --- |
| `READ_SMS` | Declared |
| `RECEIVE_SMS` | Declared |
| Notification listener access | No matching binding declaration found |
| Accessibility service | The light-mode guard declares a service protected by `BIND_ACCESSIBILITY_SERVICE` |

The published list does not identify `SEND_SMS`, `RECEIVE_MMS`, `RECEIVE_WAP_PUSH`, `READ_CALL_LOG`, `WRITE_CALL_LOG`, `ANSWER_PHONE_CALLS`, `QUERY_ALL_PACKAGES`, `PACKAGE_USAGE_STATS`, device-admin receivers, or the three Telecom services as triggers for this rule. Some have separate platform or Play policy implications. Choosing light mode within the same APK leaves the declarations visible to the installer. [Repository manifest][manifest] · [Google warning guidance, 18 August 2026][warnings]

**Geography:** The February 2024 pilot started in Singapore. Google's January 2025 recap named nine additional markets: Brazil, Hong Kong, India, Kenya, Nigeria, the Philippines, South Africa, Thailand and Vietnam. In February 2026 Google reported expansion to **185 markets** and more than 2.8 billion devices. The sources reviewed do not enumerate those markets or establish blanket coverage across Denmark, the EU or every device in either. The reported result is consistent with EFP reaching this phone. Danish dialog text establishes locale, and the applicable market signal on the phone remains unverified. [Google pilot announcement, February 2024][pilot] · [Google 2024 recap, January 2025][recap24] · [Google 2025 recap, 19 February 2026][recap25]

**Separate mechanism:** Android developer verification associates package names and signing certificates with a developer identity. Developer rollout started in March 2026, and Google announced limited accounts and the advanced user flow for August. On 30 September 2026 the initial enforcement started on certified devices for installs from seven participating stores in **Brazil, Indonesia, Singapore and Thailand**: Google Play, HONOR App Market, OPPO App Market, Galaxy Store, Palm Store, vivo V-Appstore and Xiaomi GetApps. The current timeline specifies Android 8+ for that phase and a global expansion to all apps on certified devices in 2027, with no Denmark-specific date found. Google's 29 September clarification narrows the initial scope described in earlier announcements. Neither Denmark nor direct browser downloads appear in that initial phase. Developer verification does not resolve an EFP permission block. [Android Developers Blog, 30 March 2026, clarified 29 September][march] · [Android Developers Blog, 18 June 2026, updated 15 July][june] · [Current rollout timeline, accessed 18 November 2026][timeline]

## 2. What happens on other install routes?

| Route | Documented behavior | Assessment for Plainphone |
| --- | --- | --- |
| `adb install` | Google explicitly preserves ADB for developer verification. The EFP guide names internet installers and describes Play Protect separately as an app safety system that checks apps at install time and later. [Android Developers Blog, 18 June 2026][june] · [Google warning guidance, 18 August 2026][warnings] · [Android Help, accessed 18 November 2026][protect] | The browser-specific EFP block is not expected on a normal ADB developer install. The sources do not establish a general Play Protect exemption or guarantee an install on Mads' phone. Treat ADB as an internal test route. |
| Device Owner QR enrollment using `PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION` | AOSP ManagedProvisioning commits a PackageInstaller session for the downloaded DPC. Google documents both an enterprise enrollment check for risky apps from covered internet sources and a separate requirement for an approved DPC. Private apps deployed on already fully managed devices or within work profiles currently have a developer-verification exemption. [AOSP snapshot, 8 March 2025][aosp] · [Google warning guidance, 18 August 2026][warnings] · [DPC allowlist][dpc] and [Android Enterprise verification help][enterprise], accessed 18 November 2026 | Expect a block on covered certified devices if Plainphone lacks DPC approval. The downloaded app must install before it can become Device Owner. The managed-device exemption does not establish eligibility for this bootstrap step. Removing EFP permissions would still leave the DPC approval gate. |
| Device Owner `PackageInstaller` update ([#33][issue33]) | Session options control whether Android needs user confirmation. A verifier or policy can still return `STATUS_FAILURE_BLOCKED`. On supported releases, the developer-verification failure extra can distinguish certain verification failures. Developer verification covers updates in scope and Google describes an exemption for private apps on enrolled fully managed devices and work profiles. [Android API reference for session parameters][session] and [installer result][installer], accessed 18 November 2026 · [Android Enterprise verification help, accessed 18 November 2026][enterprise] | Google does not explicitly document whether this EFP rule applies to an update downloaded and committed by the app itself. Test the app-initiated session in Device Owner mode. Successful session creation, signature validation and a silent commit request cannot prove that the update will succeed. An updater requires Plainphone to be installed first. |

**Verified in the checkout:** For #33, [SelfUpdater][selfupdater] returns after prompting in light mode, before it downloads an APK or creates an install session. If the notification is shown, tapping it opens the release download URL via `ACTION_VIEW`. The browser or other URL handler takes over, and a browser-opened download follows the browser installation path. Only Device Owner mode uses Plainphone's own `PackageInstaller` session. [AndroidUpdateHost][updatehost] · [Android update notes][updates]

For device testing, use the release signing identity and a higher version code. In Device Owner mode, record the session result and installed version. In light mode, check the notification, the handler that opens the download URL, the resulting warning or user confirmation, and the installed version.

## 3. Distribution options, costs and timing

Times below are planning estimates unless described as Google's published timing.

| Option | Price and requirements | Timing and likely effect |
| --- | --- | --- |
| Play Protect appeal | Google's public guidance lists no filing fee or Play listing prerequisite for the off-Play classification appeal. First review Mobile Unwanted Software and PHA guidance, then prepare the required contact email, package name, SHA-256 hash of the exact APK uploaded to VirusTotal, and supporting explanation. Include the release URL, version, signing certificate fingerprint and warning details as supporting evidence where relevant. [Google warning guidance, 18 August 2026][warnings] · [Google appeal form, accessed 18 November 2026][appeal] | Allow a short preparation session once evidence is available. The form states that decisions are final and filers receive no response. Google publishes no turnaround in the warning guidance. The documented EFP rule fits this APK, so treat relief as uncertain. DPC approval has its own route, with no fee or turnaround stated on Google's public allowlist page. [Android Enterprise DPC allowlist, accessed 18 November 2026][dpc] |
| Android Developer Console, full distribution | One-time **US$25** for a new account. A Google Account, identity verification and proof of control of the signing key are needed to register a package. An organization needs a website and D-U-N-S number. If Play Console is already the chosen route, it also registers off-Play packages. [Google account setup][adc] and [Google verification FAQ][adcfaq], accessed 18 November 2026 · [Android Developers Blog, 18 June 2026][june] | Set aside a setup session and allow for verification. Google says obtaining a D-U-N-S number is free and can take up to 28 days. Register for future coverage. This fee buys developer registration, with EFP and DPC approval handled separately. |
| Android Developer Console, limited distribution | Free, personal-only, with a Google Account, two-step verification, a payments profile and individual device authorization. No government ID. The dedicated help page says **50** authorized devices and restricts registration to package names never seen on Android. Other live Google help and the June announcement still say **20**. Use the dedicated page as the more specific guidance and confirm the console limit before committing to a pilot. [Limited account help][limited] · [Plan comparison][plans], accessed 18 November 2026 · [Android Developers Blog, 18 June 2026][june] | Setup plus a consent handshake per device. This is a candidate for a fresh test package only. The existing public package `org.plainphone.app` is unlikely to qualify. The authorization QR is for developer verification and serves a different purpose from Device Owner enrollment. |
| Google Play | One-time **US$25** for a new Play Console account. Use a verified organization account for Mahope, with organization documentation and D-U-N-S ready. Prepare an Android App Bundle, Play App Signing, store listing, privacy policy, Data safety and applicable sensitive-permission declarations. Plan Play-delivered updates for the Play build. [Play registration][play] · [Review preparation][review] · [Play permissions policy][policy], accessed 18 November 2026 | Budget weeks to prepare and review. For personal accounts created after 13 November 2023, Google requires 12 opted-in closed testers for 14 continuous days before requesting production access. Google says that decision usually takes up to seven days and can take longer. App review is separate. The enterprise and parental-control features still require policy review. [Play testing help, accessed 18 November 2026][testing] |
| Permission-minimized light APK | No platform fee to build and test. Preserve the system phone and SMS apps if light mode does not need to replace them. Remove SMS and call-log declarations and determine whether the guard can meet the light-mode requirements without Accessibility. Review package visibility and usage access against the actual features. Inspect the final merged manifest and use a separate package ID if both editions must coexist or stay on separate update tracks. [Google warning guidance, 18 August 2026][warnings] · [Android cross-store updates][cross] and [Play package visibility policy][visibility], accessed 18 November 2026 | Estimate several engineering days to establish a minimal build and longer if the guard needs redesign. Removing SMS and call-log permissions leaves an EFP signal if the guard remains. Dropping only the default-dialer role leaves declarations visible in the APK. A build without the documented EFP signals still needs device testing and ordinary Play Protect checks. |

**Production signing:** The [README][readme-signing] documents a test key for prerelease APKs. Confirm the certificate on the exact v0.1.9 APK before planning migration. Choose a dedicated production app-signing key before publishing. If independently built website and Play APKs should update each other, supply the same production app-signing key to Play App Signing and use it for website APKs. The Play upload key serves a separate purpose. Android requires the same application ID and signing certificate, or a valid proof of rotation, for an in-place update. Without a supported signing lineage, moving from a test-signed v0.1.9 to a differently signed production build with the same ID requires removing the old install and installing again, which clears local app data. Plan Device Owner deprovisioning and re-enrollment for affected test devices. A new application ID would also be a fresh install and can keep the test edition separate. [Play App Signing][appsigning] · [Android cross-store updates][cross], accessed 18 November 2026

For a Play submission, default SMS handling and default phone handling are different policy cases. Google lists call log and `SEND_SMS` for the default phone handler. It lists SMS reception and reading for the default SMS handler. Sensitive access must support eligible core functionality and is subject to review. The corporate device-management exception requires corporate login, and the physical-safety exception listed for emergency alerts covers sending SMS only. Neither establishes eligibility for a consumer parental-control app's SMS and call-log access. Google requires Accessibility disclosure and consent where applicable, and permits certain parent-authorized restrictions. That provision is not blanket permission to use Accessibility. Play also restricts broad package visibility and external self-updates. [Play SMS and Call Log policy][sms] · [Play developer policy][policy] · [Play package visibility][visibility] · [Play installer permission policy][request], accessed 18 November 2026

### Other distribution channels

| Channel | Requirements, cost and time | Assessment |
| --- | --- | --- |
| F-Droid main repository | No submission fee stated. Requires open source, compatible dependencies and a build from published source. F-Droid can sign its own builds, or verify a reproducible upstream-signed build. Estimate days for packaging and an open-ended review/build queue. [F-Droid inclusion policy][fdpolicy] and [reproducible builds][fdrepro], accessed 18 November 2026 | Suitable to evaluate for a light build. A different signer prevents a normal update of the existing install. Prefer reproducibility if continuity with the website signer is required. When developer verification covers this channel, register the F-Droid signing certificate for the package if F-Droid signs the build. Registering the Play or website certificate alone leaves a separately signed catalog APK uncovered. If Google requests proof of key ownership, coordinate a new F-Droid-signed build carrying the console's verification token and submit that build to the console. For an upstream-signed reproducible build, register the upstream certificate. A listing establishes no Play Protect or DPC approval. [Google open-source registration guide, updated 23 October 2026][open-source-registration] |
| Accrescent | Requires a GitHub-linked developer account, approved access and a signed APK set. Its submission page says new allowlist requests are closed. No public submission fee or reopening date stated there. [Accrescent submission docs, accessed 18 November 2026][accrescent] | No predictable onboarding date. A curated channel still leaves device-side eligibility to verify. |
| Obtainium | Free, open-source client that tracks compatible upstream releases such as GitHub and installs their APKs. No developer submission. Estimate a short setup session on a test device once a suitable release asset exists. [Obtainium repository, accessed 18 November 2026][obtainium] | An update client for technical users. It keeps the upstream APK's declarations and signature, and its installer path needs a separate device test. There is no published EFP exemption for it. |

## 4. What comparable apps do

- **Fossify Phone and Fossify Messages** ship as separate apps on F-Droid. Phone uses call-log access for its dialer, and Messages documents SMS/MMS access when used as the messaging app. This illustrates separation by user-facing role. The listings do not demonstrate browser installation under EFP in Denmark. [F-Droid Fossify Phone][fossifyphone] · [Fossify Messages][fossifymsg], accessed 18 November 2026
- **Headwind MDM** publishes its launcher APK and documents QR enrollment as well as a limited ordinary APK mode. Its maintainers say that since 2026 Google has restricted provisioning with custom builds and that these builds can be blocked by Play Protect. Headwind itself reported the sensitive-data text during QR provisioning in Thailand in December 2025. A separate F-Droid build is signed by F-Droid. The vendor's experience supports treating enrollment approval and the signing identity as first-class distribution requirements. [Headwind quick start][headwindqr] · [Headwind open-source guidance][headwind], accessed 18 November 2026 · [Headwind's first-hand report, 9 December 2025][headwindreport] · [F-Droid Headwind 6.40 listing, 14 October 2026][headwindfd]
- **Qustodio Kids** documents a Play version without call/SMS monitoring and a full Android version from its own website for that feature. This is a precedent for channel-specific capabilities. The vendor instructions do not establish install success under EFP for Plainphone. [Qustodio help, accessed 18 November 2026][qustodio]

## 5. Recommendation

### Now

1. Keep Play Protect enabled. Treat the browser install of v0.1.9 as blocked on the reported phone and QR enrollment as dependent on DPC approval until verified. Do not present either route to families as a confirmed installation path.
2. Use a controlled test on an adult-owned spare device to establish the supported paths. Record device model, OS build, Play system update, certification status, installer source, version, certificate fingerprint, APK hash and warning. Test browser and ADB separately, QR enrollment on a reset-ready spare, and the actual #33 update path in both modes. Record observed results by device, route and build.
3. Design a light build around features that work without SMS, call log, default dialer or Accessibility if the guard can be redesigned. Keep the full edition's Device Owner approval question independent. Estimate the features lost before choosing an application ID and signing plan.
4. **Requires Mads (kræver Mads):** Provide a spare device or run the device checks, and approve any reset. Review and authorize the release APK upload to VirusTotal and submission of an accurate Play Protect appeal if the evidence supports it. If strong mode remains essential, authorize an inquiry about DPC approval for the family use case. No payment decision is needed to diagnose the browser block.

### In three months, by 18 February 2027

1. Recheck Google’s rollout and the limited-plan cap. Choose Play for the light edition if the minimized build meets the product requirements and passes policy review. Use Play updates for that edition. Compare F-Droid as a secondary channel once the build and signing plan are repeatable.
2. Keep strong-mode public QR distribution gated on Android Enterprise approval and successful enrollment and update tests with the exact signed APK. Use physical device results to decide whether strong mode can become a supported family setup.
3. **Requires Mads (kræver Mads):** Use Mahope's Google Account and organization verification details. Use an existing verified Play Console account if available. If a new account is needed, approve the **US$25** one-time fee for Play Console if Play distribution is planned, or full Android Developer Console if distribution remains exclusively outside Play. Have Mads authorize account creation, payment, verification, and all store, appeal and DPC submissions. Reserve limited distribution for a genuinely new closed-test package if the personal-only account model fits.

[manifest]: ../../android/app/src/main/AndroidManifest.xml
[updates]: ../android-updates.md
[issue33]: https://github.com/plainphone/plainphone/issues/33
[warnings]: https://developers.google.com/android/play-protect/warning-dev-guidance
[pilot]: https://security.googleblog.com/2024/02/piloting-new-ways-to-protect-Android-users-from%20financial-fraud.html
[recap24]: https://blog.google/security/how-we-kept-google-play-android-app-ecosystem-safe-2024/
[recap25]: https://security.googleblog.com/2026/02/keeping-google-play-android-app-ecosystem-safe-2025.html
[march]: https://android-developers.googleblog.com/2026/03/android-developer-verification-rolling-out-to-all-developers.html
[june]: https://android-developers.googleblog.com/2026/06/android-developer-verification.html
[timeline]: https://developer.android.com/developer-verification
[protect]: https://support.google.com/android/answer/2812853
[aosp]: https://android.googlesource.com/platform/packages/apps/ManagedProvisioning/+/74f1726d242531f4f6a23e854114ba96937348c8/src/com/android/managedprovisioning/task/InstallPackageTask.java
[dpc]: https://support.google.com/work/android/answer/16694822
[enterprise]: https://support.google.com/work/android/answer/17266330
[session]: https://developer.android.com/reference/android/content/pm/PackageInstaller.SessionParams
[installer]: https://developer.android.com/reference/android/content/pm/PackageInstaller
[adc]: https://support.google.com/android-developer-console/answer/16604405
[adcfaq]: https://support.google.com/android-developer-console/answer/16561738
[limited]: https://support.google.com/android-developer-console/answer/17131204?hl=en
[plans]: https://support.google.com/android-developer-console/answer/16640817
[play]: https://support.google.com/googleplay/android-developer/answer/6112435
[review]: https://support.google.com/googleplay/android-developer/answer/9859455
[testing]: https://support.google.com/googleplay/android-developer/answer/14151465
[policy]: https://support.google.com/googleplay/android-developer/answer/18265346
[cross]: https://developer.android.com/google/play/app-updates
[visibility]: https://support.google.com/googleplay/android-developer/answer/10158779
[sms]: https://support.google.com/googleplay/android-developer/answer/10208820
[request]: https://support.google.com/googleplay/android-developer/answer/12085295
[fdpolicy]: https://f-droid.org/en/docs/Inclusion_Policy/
[fdrepro]: https://f-droid.org/en/docs/Reproducible_Builds/
[accrescent]: https://accrescent.app/docs/guide/getting-started/new-app/
[obtainium]: https://github.com/ImranR98/Obtainium
[fossifyphone]: https://f-droid.org/en/packages/org.fossify.phone/
[fossifymsg]: https://www.fossify.org/apps/messages/
[headwindqr]: https://h-mdm.com/quick-start/
[headwind]: https://h-mdm.com/open-source/
[headwindreport]: https://support.google.com/googleplay/thread/393476441
[headwindfd]: https://f-droid.org/packages/com.hmdm.launcher/
[qustodio]: https://help.qustodio.com/hc/en-us/articles/360005217237-How-do-I-set-up-calls-and-SMS-text-message-monitoring-on-Android-devices

[selfupdater]: ../../android/app/src/main/java/org/plainphone/app/update/SelfUpdater.kt
[updatehost]: ../../android/app/src/main/java/org/plainphone/app/update/AndroidUpdateHost.kt
[readme-signing]: ../../README.md
[appeal]: https://support.google.com/googleplay/android-developer/contact/protectappeals
[appsigning]: https://developer.android.com/studio/publish/app-signing
[open-source-registration]: https://developer.android.com/developer-verification/guides/open-source-app-registration?hl=en
