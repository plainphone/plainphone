# Plainphone on iPhone: architecture

Status: phase 0 (groundwork) done, and the server, dashboard and parent app are prepared for
phase 1 (see [Phase 1 preparation](#phase-1-preparation-server-and-dashboard)). No iOS code ships yet. This page is the plan the later phases
follow, based on the research in issue #163 and the maintainer decisions of 2026-11-20.
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
- **Minimum iOS 26**, the existing Apple Developer account, our own Swift Expo module and extension
  targets. No `react-native-device-activity` dependency (it is a reference, not a dependency).
- **EU app names** (FamilyActivityData, iOS 26.4+): used, off until the family turns it on, and the
  child is told.
- **SOS and help calls:** apply for Critical Alerts now; Time Sensitive notifications until granted.
- **Calls, contacts, bedtime:** a guided wizard through Apple's Communication Limits and Downtime,
  with a check that they are on. The dashboard says honestly what Apple controls.

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
config plugin is decided in phase 1, after the usual package check. The extensions contain no React
Native and no networking: the monitor extension is killed at about 6 MB, and the shield extensions
run in a sandbox without network access.

## The Swift Expo module

```
parent-app/modules/plainphone-screentime/
  expo-module.config.json
  index.ts                     # typed JS API, the only thing screens import
  ios/
    PlainphoneScreenTimeModule.swift   # Expo module: authorization, picker, apply, status
    RulesCompiler.swift        # rules document -> named stores, schedules and events
    Stores.swift               # ManagedSettingsStore names: base, school, bedtime, limits, maintenance
    AppGroup.swift             # compiled plan and event log in group.org.plainphone.app
    Receipt.swift              # what the app reports back (status additions below)
  targets/
    activity-monitor/          # DeviceActivityMonitor subclass, reads the compiled plan
    shield-configuration/
    shield-action/
    activity-report/
    location-push/
```

The JS API is small and promise-based: `requestAuthorization(kind)`, `authorizationStatus()`,
`pickActivities()` (FamilyActivityPicker, returns encoded selections), `applyRules(document)`,
`status()` and `startLocationPushes()`. Android builds get a stub that throws, so the parent app keeps
building for Android.

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
`child` and `myself`. `ROLE_FLAGS` switches Child and Myself off, so only Parent is reachable and the
app behaves exactly as today. Parent can never be switched off: a parent must always reach the
dashboard. Phase 1 turns `child` on and adds the first-launch question "Whose phone is this?"
(`needsRoleChoice`), like the Android app. A saved role the build no longer offers falls back to
Parent.

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
whole-phone limit, and the document adds `platform`, `tier`, `capabilities` and `iosApps`.

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
light-mode protections do not apply. Unknown fields are ignored, so a newer app is never refused.
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

### Left for the Swift side (phase 1 proper)

the Child role and the app's own "Whose phone is
this?" screen (`ROLE_FLAGS` in [`roles.ts`](../../parent-app/src/lib/roles.ts) still has Child off),
calling `POST /device/pairings` with `platform: "ios"` and showing the code and QR, `.child`
authorization, `RulesCompiler` for the `IosRules` document, the picker and the two selection
routes, the status `ios` object, APNs registration for wake-ups, the transparency page, release
and maintenance with the parent PIN. Then turn `IOS_PAIRING_ENABLED` on for TestFlight.

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
