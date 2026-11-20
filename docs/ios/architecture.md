# Plainphone on iPhone: architecture

Status: phase 0 (groundwork). No iOS code ships yet. This page is the plan the later phases
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

The existing parent app's bundle ID is `org.plainphone.parent` (team `P7698GU4AV`, see
[parent-app.md](../parent-app.md)). Apple requires an extension's bundle ID to start with its app's
bundle ID, so the extensions live under it:

| Target | Bundle ID |
|---|---|
| App (Parent, Child, Myself) | `org.plainphone.parent` |
| Device Activity Monitor extension | `org.plainphone.parent.activity-monitor` |
| Shield Configuration extension | `org.plainphone.parent.shield-configuration` |
| Shield Action extension | `org.plainphone.parent.shield-action` |
| Device Activity Report extension | `org.plainphone.parent.activity-report` |
| Location Push Service extension | `org.plainphone.parent.location-push` |
| App Group (shared container) | `group.org.plainphone.parent` |

**Open decision:** the phase 0 brief named the app `org.plainphone.app`. That is the Android phone
app's package name, not the iOS parent app's bundle ID. Keeping `org.plainphone.parent` keeps the
existing app, its universal links (`APPLE_APP_IDS`) and its push setup. Choosing
`org.plainphone.app` means a new App ID and a new App Store record. Decide before sending the
entitlement requests, because Apple grants them per bundle ID.

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
    AppGroup.swift             # compiled plan and event log in group.org.plainphone.parent
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

Server additions in later phases, all additive: iOS app entries as opaque token blobs with an
optional EU bundle ID, `PUT /phones/{id}/ios-selection` and `PUT /device/ios-selection`, the
`location` push type (topic `org.plainphone.parent.location-query`), and status fields
(`authorizationStatus`, `communicationLimits`, `dnsEnabled`, `locationAuth`, `iosVersion`,
`effectiveStores`).

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

Nothing sets `platform = ios` yet: iOS pairing arrives in phase 1. The lines are information about
what the platform can do, not a feature, so they have no switch: hiding them would make the
dashboard claim more than the phone does.

The rows with a line are Apps, Contacts, Web filter, Screen time (more time on request), Bedtime
(silence), Location (Ring cannot pass silent mode without Critical Alerts), Home screen, Settings and
the Myself key. The Contacts and Bedtime lines say "Set it up with the guide": that guide is the
phase 5 wizard. If phase 1 ships before phase 5, those two lines must link to Apple's own help page
(https://support.apple.com/en-us/108806) or drop the sentence until the wizard exists.

## App roles

[`parent-app/src/lib/roles.ts`](../../parent-app/src/lib/roles.ts) holds the role model: `parent`,
`child` and `myself`. `ROLE_FLAGS` switches Child and Myself off, so only Parent is reachable and the
app behaves exactly as today. Parent can never be switched off: a parent must always reach the
dashboard. Phase 1 turns `child` on and adds the first-launch question "Whose phone is this?"
(`needsRoleChoice`), like the Android app. A saved role the build no longer offers falls back to
Parent.

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
