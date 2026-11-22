# Google Play policy review

Plainphone has two Android apps:

- the **phone app** (`android/`, package `org.plainphone.app`), which runs on the phone being
  managed in strong mode (Device Owner, set up by QR on a reset phone) or light mode (an
  ordinary install, see [light-mode.md](../light-mode.md)),
- the **parent app** (`parent-app/`, Expo, Android package `org.plainphone.parent`), which
  parents use to set the rules.

This page asks, for each Play policy that touches them: does Plainphone qualify, what does
Google ask for (declaration form, video, listing text), and how likely is a rejection. It ends
with a recommendation per app. Nothing has been submitted. The listings, Data safety answers and
declaration texts are in this folder ([README](README.md)).

All policy pages below were read on **22 November 2026**. Google changes them often, so read
them again before submitting. Quotes are from those pages on that date.

## Recommendation

| App | Recommendation | Why, in one line |
|---|---|---|
| Parent app | **Play** (closed test first, then open testing as the alpha) | Two ordinary permissions (camera, notifications), no ads, no restricted APIs. The blockers are paperwork, a reviewer login, and a demo household with a paired phone, because the phone app itself is not on Play ([below](#a-parent-app-whose-phone-app-is-not-on-play)) |
| Phone app, light mode | **Play with a reduced feature set, later.** For the public alpha: GitHub Releases as today, and F-Droid when the build is reproducible ([f-droid.md](f-droid.md)) | Every part can qualify as a parental control app, but only after product changes (below), five declarations with videos and a review that can take weeks. None of it is ready, and a rejection or suspension costs the developer account |
| Phone app, strong mode | **GitHub Releases / F-Droid only** | An app installed from Play cannot become Device Owner. QR provisioning downloads the APK from our own URL, and the listing may not point to an APK outside Play. Separately, Android Enterprise now blocks unapproved DPCs during QR setup ([below](#device-owner-and-qr-provisioning)) |

The reduced Play edition of the phone app would be: light mode only, the **Child** profile only,
no self-updater, no device admin, the `isMonitoringTool` flag, a persistent notification,
separate disclosures for the guard and for location, a stated reason for the battery exemption,
and `<queries>` instead of `QUERY_ALL_PACKAGES`. The list of changes is in
[What the phone app needs before Play](#what-the-phone-app-needs-before-play).

## Policy by policy

Risk is our own estimate of a rejection on first review if the app is submitted as it is in
`origin/main` today (v0.1.19 and later), followed by the risk once the listed changes are made.

### Device Owner and QR provisioning

- **Policy pages:** [Approved Android Enterprise device policy controllers allowlist](https://support.google.com/work/android/answer/16694822),
  [Play Protect developer guidance, "Android Enterprise DPC enrollment"](https://developers.google.com/android/play-protect/warning-dev-guidance#android_enterprise_dpc_enrollment)
  (page last updated 18 August 2026).
- **What they say:** "Only DPCs verified and approved by Android Enterprise are permitted to
  install apps during enterprise device enrollment provisioning. The installation of any
  non-approved DPCs [...] will be blocked during enrollment installation." The phone shows "App
  blocked to protect your device". Not permitted for approval: "Solutions developed exclusively
  for the purpose of device monitoring or eavesdropping independent of enterprise device
  management". There is an appeal form; a Google employee wrote on the
  [Android Enterprise community forum](https://www.androidenterprise.community/android-enterprise-general-discussions-3/google-play-protect-s-new-policy-for-custom-dpc-1550)
  (8 January 2026) that "any developer can submit an appeal to have their DPC allowlisted" and
  that Android Enterprise partner status is not required. Developers in that thread report that
  appeals get no reply.
- **Does Plainphone qualify?** This is not a Google Play policy, it is Play Protect on the
  phone, and it applies to strong mode however the APK is distributed. Whether a family
  phone with visible rules counts as "device monitoring independent of enterprise device
  management" is Google's call. We found nothing that allows or forbids consumer DPCs
  explicitly.
- **Play distribution:** none. A Device Owner is installed during setup from the QR code's
  download URL, not from the store. The Play listing may not link to that APK either (see
  Stalkerware below).
- **Risk:** **high, and it affects strong mode today.** The repository does not mention it yet.
  First step: provision a Google-certified phone on Android 15 or 16 with the current QR code
  and see whether Play Protect blocks it. If it does, file the DPC appeal before the alpha.

### Stalkerware and monitoring apps

- **Policy pages:** [Malware, section Stalkerware](https://support.google.com/googleplay/android-developer/answer/9888380),
  [Use of the isMonitoringTool flag](https://support.google.com/googleplay/android-developer/answer/12955211).
- **What they say:** monitoring another person is only allowed for apps "exclusively designed
  and marketed for parents to monitor their children" (or enterprise). Such apps must declare
  `<meta-data android:name="isMonitoringTool" android:value="child_monitoring" />` in every
  version code on every track, must not hide tracking, "must present users with a persistent
  notification at all times when the app is running and a unique icon", must disclose
  monitoring in the store description, and must not link "to a non-compliant APK hosted
  outside Google Play". Play Protect then warns the user that a monitoring app is on the
  device.
- **Does Plainphone qualify?** The Child profile does: rules are visible to the child, the
  location notice, the "Are you okay?" screen and the stop screen say what is happening
  ([design-principles.md](../design-principles.md)). Three gaps:
  1. The manifest has no `isMonitoringTool` flag.
  2. As far as we can see, the phone app shows an ongoing notification only during SOS
     sending, calls, a ring, a check-in, "always on" location and an install. Light mode
     needs one whenever Plainphone runs.
  3. The **Myself** profile is for adults and is not "exclusively for parents". It does not
     send the user's data to another person (a trusted person sees no location, messages or
     history, [privacy.md](../privacy.md#trusted-people-and-setup-codes)), but the same
     package doing both makes the "exclusively" test hard to pass.
- **Needed:** the flag, a persistent notification, Child profile only in the Play edition,
  monitoring stated in the listing (the drafted listing does this), no APK links in the app
  or listing.
- **Risk:** **high** as is, **medium** after the changes.

### Accessibility API

- **Policy pages:** [Use of the AccessibilityService API](https://support.google.com/googleplay/android-developer/answer/10964491),
  [Permissions and APIs that Access Sensitive Information, "Accessibility API"](https://support.google.com/googleplay/android-developer/answer/9888170).
- **What they say:** `isAccessibilityTool` is only for apps that help people with disabilities;
  monitoring apps and launchers are named as not qualifying. Other apps must show a separate
  prominent disclosure in the app, get an affirmative action, document the use in the Play
  listing, and complete the accessibility declaration with a video. The API may not be used to
  "prevent the ability for users to disable or uninstall any app or service unless authorized
  by a parent or guardian through a parental control app".
- **Does Plainphone qualify?** Yes for the Child profile: the guard closes apps the parent has
  not allowed and protects Plainphone's own settings pages, which is the parental control
  exception. `guard_service.xml` correctly does not set `isAccessibilityTool`. The disclosure
  is the gap: the setup step says only "Open Plainphone guard in the list and switch it on to
  close apps you haven't allowed" (`light_step_guard_body`). What the guard reads (which app is
  in front, screen text on Settings pages) is only in Android's own service description, which
  the policy says cannot replace the in-app disclosure, and in the general "what will be
  managed" review, which may not be combined with it. Myself uses the guard to stop an adult
  from uninstalling Plainphone, which is outside the exception; that is another reason for
  Child only.
- **Needed:** a separate disclosure screen before the guard step, with **Agree** and **Not now**
  (draft text in [permission-declarations.md](permission-declarations.md#accessibility-service)),
  and the declaration (purpose "App functionality"; personal data collected through the
  API: "App activity, Installed apps": the guard reports minutes for apps with a time limit),
  a video of the disclosure, the consent, the decline path and the guard closing an app. Text
  in [permission-declarations.md](permission-declarations.md#accessibility-service).
- **Risk:** **high** without the separate disclosure; **medium** with it. Accessibility for
  parental control is allowed but heavily reviewed, and the guard reads screen text in Settings.

### SMS and Call Log

- **Policy page:** [Use of SMS or Call Log permission groups](https://support.google.com/googleplay/android-developer/answer/10208820).
- **What it says:** permitted for the default SMS handler (`READ_SMS`, `RECEIVE_SMS`,
  `RECEIVE_MMS`, `RECEIVE_WAP_PUSH`, `SEND_SMS`, `WRITE_SMS`) and the default Phone handler
  (`SEND_SMS`, `PROCESS_OUTGOING_CALLS`, `READ_CALL_LOG`, `WRITE_CALL_LOG`). "Apps must be
  actively registered as the default [...] handler before prompting users to accept any of SMS
  or Call Log permissions" and "must immediately stop using the permission when they're no
  longer the default handler". "Family or device locator" and "remote control of user phone"
  are named as invalid uses on their own. Data may not be exfiltrated beyond the declared
  function (Spyware policy). From 27 January 2027, account verification by call is no longer a
  permitted use (not relevant to us).
- **Does Plainphone qualify?** Yes: Plainphone is a full dialer and SMS app (in-call UI,
  conversations, MMS received) and asks for the roles through `RoleManager`. Call and SMS history stay
  on the phone ([privacy.md](../privacy.md)); the blocked log is on the phone only
  ([contacts.md](../contacts.md#the-blocked-log)). Points a reviewer may question:
  - parents can read SMS from unknown senders that were held for review on the PIN-protected
    maintenance screen (on the device, never uploaded),
  - the SOS SMS fallback uses `SEND_SMS`; as default SMS app that is covered, and
    "Physical safety/emergency alerts to send SMS" is a listed exception if it ever runs
    without the role,
  - check that no SMS or call log permission is requested before the role is granted.
- **Needed:** Permissions Declaration Form, core use "Default SMS handler" and "Default Phone
  handler", a video of the role dialogs and a call and an SMS. Text in
  [permission-declarations.md](permission-declarations.md#sms-and-call-log).
- **Risk:** **medium.** The default-handler use is real, but a dialer whose job is to block
  numbers will get questions.

### Location in the background

- **Policy pages:** [Understanding location in the background permissions](https://support.google.com/googleplay/android-developer/answer/9799150),
  [Permissions policy, "Location Permissions"](https://support.google.com/googleplay/android-developer/answer/9888170).
- **What they say:** background location only for a feature that benefits the user and is
  core; "significant user benefits include physical safety, perceived safety". Declaration
  form with one feature, a video of 30 seconds or less that shows the prominent disclosure, the
  runtime permission and the feature. The page uses "the child safety geo-fencing feature" of a
  family app as an example of a valid declared feature.
- **Does Plainphone qualify?** Yes for **Find** (a parent asks where the phone is, the phone
  answers and the child sees a notice) and the SOS position. Location is optional during setup
  and off by default for "always" ([location.md](../location.md)). The setup text ("Allow precise
  location if you want to find this phone from the dashboard", `light_step_location_body`) does
  not say that location is used when the app is closed, which the disclosure must.
- **Needed:** a disclosure before the permission dialog in the form Google expects
  (draft in [permission-declarations.md](permission-declarations.md#background-location)),
  the declaration for one feature ("Find the phone when a parent asks"), a video,
  reviewer access. Text in [permission-declarations.md](permission-declarations.md#background-location).
- **Risk:** **medium** until the disclosure says "when the app is closed"; then **medium-low**, if
  the target audience is not children (see Families).

### VpnService

- **Policy pages:** [Understanding Google Play's VpnService policy](https://support.google.com/googleplay/android-developer/answer/12564964),
  [Permissions policy, "VPN Service"](https://support.google.com/googleplay/android-developer/answer/9888170).
- **What they say:** allowed for "Parental control and enterprise management apps"; the use
  must be documented in the listing, data "from the device to VPN tunnel end point" must be
  encrypted, and a VpnService declaration is filled in Play Console.
- **Does Plainphone qualify?** Yes. The tunnel carries only DNS and forwards it over
  DNS-over-TLS to the filter ([light-mode-vpn.md](../light-mode-vpn.md)).
- **Risk:** **low.**

### Broad package visibility (`QUERY_ALL_PACKAGES`)

- **Policy page:** [Use of the broad package (App) visibility (QUERY_ALL_PACKAGES) permission](https://support.google.com/googleplay/android-developer/answer/10158779).
- **What it says:** permitted uses are "device search, antivirus apps, file managers, and
  browsers". Parental control is **not** listed (the table in [light-mode.md](../light-mode.md)
  said it was; it is corrected there). Not allowed "when the required task can be done with a
  less broad app-visibility method".
- **Does Plainphone qualify?** Probably not. The allowlist needs every *launchable* app, which
  a `<queries>` element with `MAIN`/`LAUNCHER` gives without the permission.
- **Needed:** drop `QUERY_ALL_PACKAGES` in the Play edition and use `<queries>`; check that app
  updates and the catalog still find packages without a launcher icon where that matters.
- **Risk:** **high** with the permission, **none** without it.

### Self-updates and downloaded code

- **Policy pages:** [Device and Network Abuse](https://support.google.com/googleplay/android-developer/answer/9888379),
  [Permissions policy, "Request Install Packages"](https://support.google.com/googleplay/android-developer/answer/9888170).
- **What they say:** "An app distributed via Google Play may not modify, replace, or update
  itself using any method other than Google Play's update mechanism."
- **Does Plainphone qualify?** Not as built today: `update/SelfUpdater.kt` checks
  `/download/android/latest.json` and, in light mode, asks the child to install a newer APK.
  The Play edition must leave the self-updater out (a build property, like
  `-PplainphonePlay=true` already does for billing). The JavaScript in the parent app is
  bundled; it has no `expo-updates`, so nothing is downloaded.
- **Risk:** **certain rejection** with the updater, **none** without it.

### Battery optimisation exemption

- **Policy page:** [Optimize for Doze and App Standby, "Acceptable use cases for exemption"](https://developer.android.com/training/monitoring-device-state/doze-standby#exemption-cases).
- **What it says:** "Google Play policies prohibit apps from requesting direct exemption from
  Power Management features [...] unless the core function of the app is adversely affected."
  In general an app does not qualify "unless Doze or App Standby breaks the core function of the
  app or there is a technical reason why your app can't use FCM". The table lists "Safety app.
  Apps that keep their users and their families safe" as acceptable, and chat apps that can use
  FCM as not acceptable. There is no Play Console form; reviewers check it against this page.
- **Plainphone:** the manifest declares `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, and light mode's
  "Keep Plainphone running" setup step (`LightSetup`, `Step.RUNNING`) opens the direct dialog
  (`batteryExemptionRequest`, with `@SuppressLint("BatteryLife")`). Strong mode uses it for the
  install watchdog, which is not in the Play edition. In light mode the reason is real: rules,
  time limits, call filtering and the answer to Find and SOS run in the background, and the Play
  edition should not ship FCM (Families, below), so it wakes by polling or UnifiedPush, which
  Doze delays. Plainphone fits "apps that keep their families safe" by category, although its
  own texts never promise safety.
- **Needed:** a justification in the review notes (text in
  [permission-declarations.md](permission-declarations.md#battery-optimisation-exemption)), and
  the step must keep explaining why before the dialog opens. If a reviewer refuses it, the
  fallback is `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` (the settings list, no direct
  dialog), which needs no permission; the setup step already has an "Open battery settings" button
  for phone makers that need more than the dialog.
- **Risk:** **medium-low.**

### Device admin

- **Policy pages:** [Malware, sections Privilege Escalation and Ransomware](https://support.google.com/googleplay/android-developer/answer/9888380),
  [Use of the AccessibilityService API](https://support.google.com/googleplay/android-developer/answer/10964491).
- **What they say:** the Malware page lists "Apps that abuse features to prevent them from being
  uninstalled or stopped", and under Ransomware: "Don't use device admin features to block
  uninstallation" and "Provide a clear and easy way for users to remove your app". We found no
  parental control exception for device admin on Play. The exception that does exist is in the
  Accessibility policy: preventing uninstall is allowed when "authorized by a parent or
  guardian through a parental control app".
- **Plainphone:** light mode asks to become device admin (`LightAdminReceiver`, the "Protect
  Plainphone" step) with one non-deprecated policy (`force-lock`), and its only purpose is that
  Plainphone must be switched off as admin before it can be uninstalled. That is exactly the use
  the Malware page names. The admin does not block anything by itself (the child can switch it
  off and the parent is told), but a reviewer reads the purpose, not the mechanism.
- **Needed:** leave the device admin step and `LightAdminReceiver` out of the Play edition. The
  guard still protects Plainphone's own settings pages under the accessibility parental control
  exception, and the parent still hears when Plainphone is removed (the phone stops checking
  in). The Play listing no longer mentions device admin. Keep it in GitHub and F-Droid builds.
- **Risk:** **high** with device admin, **none** without it.

### A parent app whose phone app is not on Play

- **Policy pages:** [Spam and Minimum Functionality](https://support.google.com/googleplay/android-developer/answer/9898783),
  [Requirements for providing sign in details for review](https://support.google.com/googleplay/android-developer/answer/15748846),
  [Malware, section Stalkerware](https://support.google.com/googleplay/android-developer/answer/9888380).
- **The problem:** the parent app does nothing until a phone is paired, and under the
  recommendation above the phone app is not on Play. A reviewer who installs the parent app
  cannot get the phone app from Play, sees an empty overview and may reject it for minimum
  functionality or because the app cannot be reviewed. A user reading the listing cannot follow
  it either if it does not say where the phone app comes from.
- **Needed:**
  - the review account has a **demo household with an already paired phone** that sends
    realistic, invented data (apps, time used, a request waiting, a position), so every screen
    works without a second device. That needs a simulated phone on the server for the review
    account only (part of the review sign-in, [Reviewer access](#reviewer-access)), plus a
    sentence in the review notes that the phone app is distributed outside Play and why;
  - the listing says where the phone app comes from without linking to an APK: "How to set up
    the child's phone is at plainphone.org." The site's front page, not `/download/`. The
    Stalkerware rule against links "to a non-compliant APK hosted outside Google Play" is
    written for the monitoring app itself; the parent app is not installed on the monitored
    phone, but it is the receiving end, so a reviewer may still apply it. Keep the link to the
    home page, never to an APK or the download page, also inside the app.
- **Risk:** **medium.** The demo household removes the functional objection. What remains is a
  reviewer's reading of a companion app to a monitoring app that is not on Play.

### Families policy and target audience

- **Policy page:** [Google Play Families Policies](https://support.google.com/googleplay/android-developer/answer/9893335).
- **What it says:** the target audience is declared in Play Console and Google may override it
  based on imagery and wording. "Apps that solely target children may not request location
  permission". Apps whose audience includes children must meet the Families requirements
  (disclosed data practices, only SDKs approved for child-directed services, legal compliance
  with COPPA and GDPR).
- **Plainphone:** both apps are installed and set up by a parent, so the target audience is
  **18 and over** for both. The phone app's screens are used by a child, and the listing says
  so plainly; it does not use child-directed imagery. If Google puts the phone app in a mixed
  audience, the Families rules apply: no ads (there are none), no unapproved SDKs (only
  Play Billing in the Play edition; FCM is a build option and should stay off there), and the
  location exception becomes harder to argue.
- **Risk:** **medium** for the phone app, **low** for the parent app.

### Data safety, privacy policy and account deletion

- **Policy pages:** [Data safety section](https://support.google.com/googleplay/android-developer/answer/10787469),
  [User Data](https://support.google.com/googleplay/android-developer/answer/9888076),
  [App account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111).
- **What they say:** every app fills in the Data safety form. Apps with accounts need an in-app
  path to delete the account and a web link where deletion can be requested; the link must
  load, reference the app or developer and feature the deletion path prominently.
- **Plainphone:** the answers are drafted in [data-safety.md](data-safety.md). In-app
  deletion exists (Settings → Delete my account, `DELETE /api/me`). For the web link, the
  privacy policy at <https://plainphone.org/privacy/> explains deletion and gives the address;
  a short page or anchor whose first lines are about deleting an account is safer.
- **Risk:** **low.**

### Reviewer access

- **Policy page:** [Requirements for providing sign in details for review](https://support.google.com/googleplay/android-developer/answer/15748846).
- **What it says:** sign-in details must be reusable, always valid, and get past one-time codes.
- **Plainphone:** sign-in is by a one-time link sent by mail ([parent-app.md](../parent-app.md#login-and-other-links)).
  A reviewer cannot use that. Both apps need a review sign-in: for example a server setting that
  lets one review account sign in with a fixed code, off by default and only on the hosted
  service. The phone app's reviewer also needs a phone entry to pair with, so the review account
  should already have a household with a pairing code ready. The parent app's reviewer has no
  phone at all, so the same account also needs a simulated phone that is already paired
  ([below](#a-parent-app-whose-phone-app-is-not-on-play)).
- **Risk:** **certain rejection** without it.

### Foreground services, full-screen intents and alarms

- **Policy pages:** [Foreground service and full-screen intent requirements](https://support.google.com/googleplay/android-developer/answer/13392821),
  [Permissions policy, "Exact Alarm" and "Full-Screen Intent"](https://support.google.com/googleplay/android-developer/answer/9888170).
- **Plainphone:** foreground service types `mediaPlayback` (ring the phone), `shortService`
  (SOS sending) and `systemExempted` (install watchdog, only needed by the self-updater and
  strong mode, so not in the Play edition). Each type gets a Play Console declaration with a
  short video; `mediaPlayback` is the ring. `USE_FULL_SCREEN_INTENT` is granted automatically to
  calling apps, and Plainphone is the default dialer. `SCHEDULE_EXACT_ALARM` is not the
  restricted `USE_EXACT_ALARM`, so it needs no declaration.
- **Risk:** **low.**

### Target API level

- **Policy page:** [Target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878).
- **What it says:** since 31 August 2026, new apps and updates must target Android 16 (API 36)
  or higher.
- **Plainphone:** the phone app targets 37 (`android/app/build.gradle.kts`). The parent app
  uses Expo SDK 58's default; check the built AAB (`aapt2 dump badging`) shows 36 or higher.
- **Risk:** **none.**

### The developer account

- **Policy page:** [App testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465).
- **What it says:** personal accounts created after 13 November 2023 must run a closed test with
  at least 12 testers opted in for 14 days in a row before production access.
- **Plainphone:** use an **organisation** account for the company that runs the hosted service
  (the privacy policy names it). That needs the organisation verification (D-U-N-S number), and
  it avoids the 12-tester rule. A closed test is still the right first step.

## What the phone app needs before Play

Product changes, each one a separate issue. Items 1 to 5 and 8 are done in the `play` build
flavor ([play-edition.md](play-edition.md)); 6, 7, 9, 10 and 11 are still open.

1. A Play build property for the phone app that leaves out the self-updater (`SelfUpdater`, the
   install watchdog, `systemExempted`), every link to `/download/android`, and strong-mode
   setup.
2. `isMonitoringTool` = `child_monitoring` in the Play edition's manifest.
3. A persistent notification while Plainphone runs in light mode (one quiet, low-importance
   channel; it can say what is on, in the child's words).
4. Only the **Child** profile (no Myself) in the Play edition, with the toggle rules unchanged.
5. `<queries>` for launcher apps instead of `QUERY_ALL_PACKAGES`.
6. A review sign-in on the server, off by default, for both apps.
7. Make sure no SMS or call log permission is requested before the role is granted, and that
   the app stops reading SMS and the call log when it loses the role.
8. Separate in-app disclosures with an affirmative choice for the guard (accessibility) and for
   location in the background, before Android's own screens. Draft texts are in
   [permission-declarations.md](permission-declarations.md); they need all five languages.
9. Play App Signing: upload the existing production key ("use my own key") so Play builds,
   GitHub APKs and an F-Droid build share one signature. Otherwise a phone cannot move between
   them without uninstalling.
10. Leave the device admin step and `LightAdminReceiver` out of the Play edition
    ([Device admin](#device-admin)).
11. Keep the "Keep Plainphone running" step's explanation before the battery dialog, and put the
    justification in the review notes ([Battery optimisation exemption](#battery-optimisation-exemption)).

## What the parent app needs before Play

1. The review sign-in (above), with a demo household whose phone is already paired and sends
   invented data ([A parent app whose phone app is not on Play](#a-parent-app-whose-phone-app-is-not-on-play)).
2. A web page for account deletion, or an anchor on the privacy page whose first lines are about
   it.
3. The Android push file (`PLAINPHONE_PARENT_GOOGLE_SERVICES_FILE`) for the Play build, as for
   any parent-app build with push.
4. Phone screenshots in a 9:16 frame ([screenshots.md](screenshots.md)).
