# Plainphone on iPhone: architecture

Status: phase 0 (groundwork) done, the server, dashboard and parent app are prepared for
phase 1 (see [Phase 1 preparation](#phase-1-preparation-server-and-dashboard)), and the phase 1
skeleton is in the repo (see [What exists now](#what-exists-now-phase-1-skeleton)): the Swift module,
the extension targets and the Child role, behind a build switch. It has not run on a real iPhone
yet, and no iOS build ships it until the spikes have. This page is the plan the later phases
follow, based on the research in issue #163 and the maintainer decisions of 2026-11-20 and 21.
Related: [apple-applications.md](apple-applications.md) (entitlement requests) and
[spikes.md](spikes.md) (questions to answer on a real iPhone).

## Decisions (2026-11-20)

- **One app with roles.** The existing parent app (Expo, [`parent-app/`](../../parent-app)) becomes
  the iPhone app for all three roles: Parent, Child and Myself. One listing, one review, one set of
  entitlements, one APNs topic.
- **Family Controls is the product** (tier `family_controls`). An optional guide and profile
  generator for supervision with Apple Configurator comes in phase 7 (tier `supervised`). No own
  MDM now; a spike after Tier 1 ships decides whether there ever is one.
- **The app is free and complete.** Any payment happens outside the app (App Review 3.1.1 and 4.10).
- **Minimum iOS 26 for the Child role**, the existing Apple Developer account, our own Swift Expo
  module and extension targets. Parents keep using the app from iOS 16.4 (2026-11-21, see
  [App roles](#app-roles)). No `react-native-device-activity` dependency (it is a reference, not a dependency).
- **EU app names** (FamilyActivityData, iOS 26.4+): used, off until the family turns it on, and the
  child is told.
- **SOS and help calls:** apply for Critical Alerts now; Time Sensitive notifications until granted.
- **Calls, contacts, bedtime:** a guided wizard through Apple's Communication Limits and Downtime,
  with a check that they are on. The dashboard says honestly what Apple controls.

## Decisions (2026-11-21, phase 1 skeleton)

- **School time, bedtime and the daily limit are hidden quietly in phase 1.** The iPhone does not
  enforce them yet and does not report them as failed, so the dashboard shows the base lock as
  intact without them and does not say they are missing. They stay in the rules document and in the
  compiled plan; one switch turns them on in phase 2. See
  [Phase 1: what the iPhone does not enforce yet](#phase-1-what-the-iphone-does-not-enforce-yet).
- **The base lock is always on:** passcode, accounts and automatic date and time are locked on every
  paired iPhone, with no per-phone switch, like the Android lock itself.
- **iOS minimum for the Child role only:** parents keep the app from iOS 16.4; "Whose phone is
  this?" and the child setup appear only on iOS 26 or later.
- **Kept as built:** Screen Time permission comes before pairing; an app selection the phone cannot
  read shields every app (allow list) or keeps the old shield (block list); a phone removed from the
  dashboard keeps its lock until a new pairing or a release; the dev host uses
  `org.plainphone.app.dev`.

## Bundle IDs

The iPhone app uses the existing App Store Connect record for `org.plainphone.app` (team `P7698GU4AV`, see
[parent-app.md](../parent-app.md)). Apple requires an extension's bundle ID to start with its app's
bundle ID, so the extensions live under it:

| Target | Bundle ID |
|---|---|
| App (Parent, Child, Myself) | `org.plainphone.app` |
| Device Activity Monitor extension | `org.plainphone.app.activity-monitor` |
| Shield Configuration extension | `org.plainphone.app.shield-configuration` |
| Shield Action extension | `org.plainphone.app.shield-action` |
| Device Activity Report extension | `org.plainphone.app.activity-report` |
| Location Push Service extension | `org.plainphone.app.location-push` |
| App Group (shared container) | `group.org.plainphone.app` |

The maintainer confirmed this ID on 2026-11-20. The App Store Connect record already has Family
Controls and In-App Purchase. Register the Firebase iOS app as `org.plainphone.app` as well.
See [push setup](../push-setup.md) for the APNs topic and Firebase configuration.

## Targets

| Target | Language | Purpose | Entitlements |
|---|---|---|---|
| App | React Native plus the Swift module | Parent UI (today). Child and Myself: rules page, requests, SOS, Help, PIN approval, pairing, sync, status | Family Controls, App Group, Location Push, Push, Time Sensitive (Critical Alerts when granted). EU: App and Website Usage |
| Device Activity Monitor | Swift | Applies or lifts stores at schedule and threshold events, writes events to the App Group | Family Controls, App Group |
| Shield Configuration | Swift | The Plainphone-styled shield with the rule's reason and "Ask for more time" | Family Controls, App Group |
| Shield Action | Swift | Records the request in the App Group and posts a local notification | Family Controls, App Group |
| Device Activity Report | Swift | On-device daily totals for the Child and Myself views | Family Controls, App Group |
| Location Push Service | Swift | Answers Find and check-in deadlines with one position | Location Push, App Group |

A content filter extension (child devices only) is later work and not part of phase 0's requests.

The extensions are generated as Xcode targets at prebuild from hand-written Swift sources, in the
style of `@bacons/apple-targets`. Whether we take that package as a dev dependency or write a small
config plugin is still open: today the extension targets are built by the xcodegen project in
[`ios/`](../../ios), not by the Expo prebuild. The extensions contain no React
Native and no networking: the monitor extension is killed at about 6 MB, and the shield extensions
run in a sandbox without network access.

## The Swift Expo module

```
parent-app/modules/plainphone-screentime/
  expo-module.config.json      # Apple only; Android builds do not link it
  index.ts                     # typed JS API, the only thing screens import
  ios/
    PlainphoneScreenTime.podspec
    PlainphoneScreenTimeModule.swift   # Expo bridge: JSON strings in and out, no logic
    Core/                      # pure Swift except FamilyControlsApplier; unit tested
      RulesDocument.swift      # decodes and checks the IosRules document
      RulesCompiler.swift      # rules document -> CompiledPlan (stores, windows, today's limit)
      Stores.swift             # ManagedSettingsStore names: base, school, bedtime, limits, maintenance
      AppGroup.swift           # compiled plan, receipt and event log in group.org.plainphone.app
      Receipt.swift            # what the app reports back (status additions below)
      ScreenTimeApplier.swift  # the ScreenTimeApplying seam and FakeScreenTime
      FamilyControlsApplier.swift  # the real one (FamilyControls, ManagedSettings, DeviceActivity)
      ScreenTimeEngine.swift   # one sync: check, compile, apply, save, receipt
      ShieldCopy.swift         # the shield's words in da, en, sv, nb, de
  targets/
    activity-monitor/          # DeviceActivityMonitor subclass, reads the compiled plan
    shield-configuration/
    shield-action/
    # activity-report/ and location-push/ come with phases 2 and 3
```

The JS API is small and promise-based: `requestAuthorization(kind)`, `authorizationStatus()`,
`applyRules(document, etag, phoneId, selection)`, `setMaintenance(on, selection)`,
`beginNewPairing()` and `status()`. The Swift module also has `pickActivities()`
(FamilyActivityPicker) and `startLocationPushes()`, which reject until spike (a) and phase 3.
Outside an iPhone build (Android, web, Expo Go) `nativeScreenTime()` returns a stub that throws,
so the parent app keeps building everywhere.

## How it talks to the sync API

The app is the only part that talks to the network. Extensions only flip stores.

1. The app fetches `GET /device/rules` with the device token, like the Android phone
   ([sync-api.md](../sync-api.md)).
2. `RulesCompiler` turns the document into named ManagedSettings stores and DeviceActivity
   schedules and events. An invalid document leaves the old stores in place, so an error never
   makes the phone looser.
3. It saves the compiled plan in the App Group for the extensions.
4. It reports the receipt with `PUT /device/status`.

Wake-ups: an APNs background push on rule changes (the server's existing APNs provider),
`BGAppRefreshTask`, sync on foreground, and the location push for Find and check-ins. iOS throttles
background pushes and drops them after a force quit, so rule changes can take minutes to hours if
the child never opens the app. The dashboard has to say so on iPhones.

App selections (`PUT /phones/{id}/ios-selection`, `PUT /device/ios-selection`) and the status
fields (`authorizationStatus`, `communicationLimits`, `dnsEnabled`, `locationAuth`, `iosVersion`,
`effectiveStores`) exist since the phase 1 preparation. Still to come, all additive: the optional EU
bundle ID next to a selection (phase 6) and the `location` push type (topic
`org.plainphone.app.location-query`, phase 3).

## Capability map

Phase 0 adds the map the dashboard needs before any iPhone pairs:

- `phones.platform`: `android` (default, every existing phone) or `ios`.
- `phones.ios_tier`: null on Android; `family_controls` or `supervised` on an iPhone.
- The phone summary (`GET /phones`, `GET /phones/{id}`) returns `platform`, `tier` (Android: the
  mode; iPhone: the iOS tier, `family_controls` when not set) and `capabilities`: one of `yes`,
  `partial` or `no` for each feature. The table is in
  [`server/src/lib/capabilities.ts`](../../server/src/lib/capabilities.ts) and follows the parity
  matrix in the research; see `Capabilities` in [`openapi.yaml`](../../server/openapi.yaml).
- The web dashboard and the parent app show, under each rule on an iPhone that is not `yes`, one
  short line saying what Apple controls (for example "On iPhone, Apple controls who can call. Set it
  up with the guide."), a note above the rules, and an "iPhone" tag instead of the mode.
  Android phones look exactly as before.

An iPhone gets `platform = ios` when it pairs with `"platform": "ios"`, which the server only
accepts while `IOS_PAIRING_ENABLED` is on (phase 1 preparation, below). The lines are information about
what the platform can do, not a feature, so they have no switch: hiding them would make the
dashboard claim more than the phone does.

The rows with a line are Apps, Contacts, Web filter, Screen time (more time on request), Bedtime
(silence), Location (Ring cannot pass silent mode without Critical Alerts), Home screen, Settings and
the Myself key. The Contacts and Bedtime lines point to Screen Time on the parent's iPhone ("Set it up in Screen
Time under Communication Limits"), because phase 1 can ship before the phase 5 wizard. When the
wizard exists, the lines can point to it instead.

## App roles

[`parent-app/src/lib/roles.ts`](../../parent-app/src/lib/roles.ts) holds the role model: `parent`,
`child` and `myself`. `ROLE_FLAGS` decides which roles a build offers. Parent can never be switched
off: a parent must always reach the dashboard. Child is on only in an iPhone build made with
`PLAINPHONE_IOS_CHILD=1` (`extra.iosChildRole` in `app.config.ts`), and only on iOS 26 or later:
`childRoleOffered` checks `Platform.Version` against `CHILD_MIN_IOS_MAJOR` at run time, so the same
build still works for a parent on an older iPhone (from iOS 16.4, the podspec's minimum). Every
other build or iPhone offers Parent only and behaves exactly as before; the role question and the
child setup send it to the dashboard, also when opened from a link. Myself stays off. In a build with Child, the first launch asks
"Whose phone is this?" (`needsRoleChoice`, [`role.tsx`](../../parent-app/src/app/role.tsx)), like the
Android app, unless a parent is already signed in, who then keeps the dashboard without a question
([`role-context.tsx`](../../parent-app/src/lib/role-context.tsx)). A saved role the build no longer
offers falls back to Parent.

## Phase 1 preparation: server and dashboard

Done before any Swift code, so the server, the dashboard and the parent app are ready when the
spikes have run on a real iPhone. Everything is behind one server switch, `IOS_PAIRING_ENABLED`
(default `false`, [self-hosting.md](../self-hosting.md)).

### Pairing

`POST /device/pairings` takes `"platform": "ios"`. With the switch off the server
answers 403 `{"code": "ios_pairing_not_yet"}`: the app shows "This server cannot add iPhones yet",
not an error. With it on, the pairing is stored with its platform and always as a light pairing
(no Device Owner), `GET /phones/pairing-profile` returns `platform`, and the claim creates the
phone with `platform = ios` and `ios_tier = family_controls`. A claim after the switch went off is
refused the same way. Android pairing is unchanged. Migration `0052_ios_pairing` adds
`pairings.platform` and the `ios_selections` table.

### iOS rules document

An iPhone's `GET /device/rules` is the Android document projected through an
allowlist (`IOS_RULE_KEYS` in [`server/src/services/ios-rules.ts`](../../server/src/services/ios-rules.ts)).
Each key is tied to the capability it needs and left out when the phone's tier says `no`
(for example `lockSystemLanguage`). Android mechanisms never reach an iPhone: package names, modes
with app lists, Android settings and home screen, FCM and UnifiedPush, private DNS, app update
windows and Google accounts (`ANDROID_ONLY_RULE_KEYS`; a test fails when a new Android key is not
placed in one of the two lists). Schedules lose their app lists, time limits keep only the
whole-phone limit and its bonuses (the `*` rows, so an approved "more time" for the whole phone
reaches the iPhone; per-app limits and bonuses wait for app tokens), and the document adds
`platform`, `tier`, `capabilities` and `iosApps`. `pendingChanges` keeps only `id`, `type`,
`keyType` and `effectiveAt`: enough for the transparency page to say that a change of a kind is
coming and when. The contents (which contact, how many minutes) are left out in phase 1 because
many ops carry package names; sending platform-neutral fields is left for the Swift side to ask for.

### App selections

The apps an iPhone allows (or blocks, in open mode) are Apple's encoded
`FamilyActivitySelection`, stored per phone as an opaque base64 blob of at most 128 KiB
(`ios_selections`). Two routes, each behind a capability, because spike (a) decides which one
phase 1 uses:

| Route | Who picks | Capability | Today |
|---|---|---|---|
| `PUT /phones/{id}/ios-selection` | The parent, on their own iPhone | `pickAppsOnParent` | `partial` until spike (a); set it to `no` if tokens do not work across devices |
| `PUT /device/ios-selection` | The child's iPhone, after the parent PIN | `pickAppsOnPhone` | `yes` |

A parent's pick is a rule change (new rules revision and a wake-up); a pick on the phone already
happened there, so the server records it. The rules document carries only `iosApps.selection`
(`revision`, `source`, `updatedAt`); the phone fetches the bytes from `GET /device/ios-selection`
when the revision changes. Android phones get 409 `not_supported` on both routes.

### Receipts and status

`PUT /device/status` takes an `ios` object (`iosVersion`, `authorizationStatus`,
`communicationLimits`, `dnsEnabled`, `locationAuth`, `effectiveStores`). An iPhone's lock counts as
intact only while `authorizationStatus` is `approved`, nothing failed and no maintenance runs; the
light-mode protections do not apply. Unknown fields are ignored, and `iosVersion`,
`authorizationStatus` and `locationAuth` take any short string (a beta version, a case Apple adds
later), so a newer app is never refused; a value other than `approved` never counts as intact.
Receipts use the same `rulesEtag` and `rulesReceiptConfirmed` fields as Android.

### Dashboard and parent app

"Add phone" offers "An iPhone" only while `GET /me` says
`iosPairing: true`. That path asks "Whose phone is this?" (Child or Myself), lists Apple's
prerequisites (Family Sharing, a child Apple Account, Screen Time on; only Screen Time for Myself)
with a link to Apple's guide, and then takes the code or QR code the iPhone shows. On an iPhone's
pages, a rule the tier cannot do at all is shown as text with its line instead of a link to
switches that would do nothing, the Apps page says apps are picked on the iPhone and when they were
last picked, the health card checks Screen Time permission instead of Android's protections, and
light mode's Android parts (Private DNS choice, contact restriction, protections list) are hidden.

## What exists now (phase 1 skeleton)

Built without a real iPhone, so everything that depends on a spike sits behind a seam with a
`TODO(spike …)` pointing to [spikes.md](spikes.md). Details and the seam table: [ios/README.md](../../ios/README.md).

- **Swift module.** `RulesDocument` decodes the `IosRules` document leniently where the server may
  grow (unknown keys, the family's switches default to on as the server documents) and strictly
  where a wrong value would loosen the phone (platform, phone id, times, weekdays, limits).
  `RulesCompiler` makes the `CompiledPlan`: the base store (allow list or, in open mode, block list;
  no installs or removals; locked accounts, passcode and automatic date), the school and bedtime
  windows, today's whole-phone limit with today's bonuses in the phone's time zone, and the family's
  `askMoreTimeEnabled` and `limitWarningEnabled`. `ScreenTimeEngine` applies it through
  `ScreenTimeApplying` (`FamilyControlsApplier`, or `FakeScreenTime` in tests and the simulator),
  saves it in the App Group and keeps the receipt. An invalid document or a failed apply leaves
  the old stores and the old ETag in place and puts the reason in `failedPolicies`. A released phone
  never locks again until a new pairing (`beginNewPairing`).
- **Phase 1 applies the base store only.** School time, bedtime and the daily limit are not
  enforced; see the next section.
- **Extensions.** The Device Activity Monitor and the two shield extensions exist as targets and
  read the plan from the App Group. The shield shows the reason in the phone's language and one
  button that closes the app.
- **Child role in the app.** "Whose phone is this?", then a guided setup
  ([`child/setup.tsx`](../../parent-app/src/app/child/setup.tsx), steps in
  [`wizard.ts`](../../parent-app/src/lib/iphone/wizard.ts)): welcome, Screen Time permission
  (`.child`, the parent approves with their Apple Account), pairing by QR code and code
  (`POST /device/pairings` with `platform: "ios"`, [`pairing.ts`](../../parent-app/src/lib/iphone/pairing.ts)),
  the Apple settings Plainphone cannot set (Communication Limits, Downtime; can wait), done. The
  step is derived from facts, so the setup resumes in place and permission can never be skipped.
- **Sync and receipts.** [`sync.ts`](../../parent-app/src/lib/iphone/sync.ts) fetches
  `GET /device/rules` with the applied ETag, fetches `GET /device/ios-selection` when the selection's
  revision changes, lets the Swift module apply both, and reports with `PUT /device/status` (the
  `ios` object, `rulesEtag`, `rulesReceiptConfirmed`). A release is applied, then acknowledged with
  `POST /device/released`, again at the next sync if the answer is lost. The device token lives in
  the Keychain, apart from a parent's session.
- **The child's screen** ([`child/index.tsx`](../../parent-app/src/app/child/index.tsx)) says that
  Plainphone is on and lists what the phone tells the parents, as the
  [design principles](../design-principles.md) ask (no hidden monitoring).
- **CI.** The `ios` job builds the dev host with its extensions for the simulator and runs the unit
  tests on macOS. `ios/scripts/linux-check.sh` runs the same tests in the Swift container on Linux.

Still to do for phase 1: run the spikes, wire the extension targets into the Expo prebuild (config
plugin or `@bacons/apple-targets`), the app's own entitlements in a `PLAINPHONE_IOS_CHILD=1` build
(`com.apple.developer.family-controls` and the App Group `group.org.plainphone.app` in
`ios.entitlements` in `parent-app/app.config.ts`; without them `requestAuthorization` fails and the
rules are stored where the extensions cannot read them), the picker (spike a), maintenance and release with the parent
PIN on the phone, APNs registration for wake-ups and background refresh (spike d), and a first
Expo build on a Mac. Then turn `IOS_PAIRING_ENABLED` on for TestFlight.

## Phase 1: what the iPhone does not enforce yet

Phase 1 does **not** enforce school time, bedtime (for apps) or the daily time limit on an iPhone,
and the dashboard and the parent app **do not show** that: an iPhone with those rules set shows its
lock as intact, and the rules look the same as on Android. This is a deliberate choice for the
phase 1 test builds (decision 2026-11-21), not something the code hides by accident:

- The Swift core has one switch, `IosEnforcement.enforcesSchedules`
  ([`Enforcement.swift`](../../parent-app/modules/plainphone-screentime/ios/Core/Enforcement.swift)),
  `false` in phase 1. The rules document still carries the schedules and the limit, and
  `RulesCompiler` still compiles them into the plan (`activities`, `dailyLimitMinutes`), but the
  plan's `monitoredActivities` and `monitoredDailyLimitMinutes` stay empty, so `FamilyControlsApplier`
  starts nothing and reports nothing. A problem with them (an unknown schedule kind or time zone)
  is not reported either, because nothing that is not enforced can fail.
- The server never expects the `school`, `bedtime` or `limits` stores from an iPhone
  (`iosLockIntact` in [`server/src/lib/ios.ts`](../../server/src/lib/ios.ts)), and the capability
  map keeps `schoolTime`, `bedtimeApps` and `timeLimits` at `yes`, so no iPhone line appears under
  those rules. Android is unchanged.
- Phase 2 builds the DeviceActivity monitoring and sets the switch to `true`. If the switch is
  turned on before the monitoring exists, the applier reports the windows and the limit as failed,
  so the dashboard never claims more than the phone does.

## Phases

Each phase ships on its own. Every feature keeps a per-phone switch in the dashboard and the parent
app, like on Android.

0. **Entitlements and spikes** (this change, no release): the requests in
   [apple-applications.md](apple-applications.md), the capability map, the role model and the
   spike scripts in [spikes.md](spikes.md).
1. **Tier 1 core:** the Child role, pairing by code and QR with `platform: ios`, `.child`
   authorization with clear child-facing text, the base store (allowlist shield, no installs or
   removals, locked accounts, passcode and date), rules sync, receipts, the transparency page,
   release, maintenance with the parent PIN. TestFlight, then the App Store.
2. **Schedules and limits:** school time, bedtime for apps, time limits, the 5-minute warning, more
   time on request with answers from the parent app and the dashboard.
3. **Safety:** SOS, Find through location push, check-in, Ring (Time Sensitive; Critical Alerts if
   granted), help lines.
4. **Web filter:** per-phone DNS over TLS through NEDNSSettingsManager with a guided enable step and
   a health check, Apple's adult filter, domain block lists for the social and gambling categories.
5. **Communication:** the Apple-settings wizard (Communication Limits, Downtime contacts), approved
   contacts written to Contacts, the receipt through Declared Age Range, the bedtime honesty text.
6. **EU app names:** FamilyActivityData bundle IDs, catalog lookup, approving apps by name in the
   dashboard. Off until the family turns it on, and the child is told.
7. **Tier 2 guide:** a walkthrough for Apple Configurator, the signed profile generator, an iOS
   bypass checklist.
8. **Tier 3 decision:** a written analysis of the MDM vendor certificate and App Review 5.5. Built
   only after a separate go.
