# Apple applications for the iPhone app

These are the requests the Account Holder of Plainphone's Apple Developer account sends to Apple
before the iPhone app can ship (phase 0 in [architecture.md](architecture.md)). Development builds
on registered devices work without them, so phases 1-3 can start while Apple reviews.

Apple's request forms sit behind the developer sign-in, so this page could not read them. Field
names marked **(unverified)** come from Apple's documentation and developer reports, not from the
form itself. Paste the text into whatever field asks for the same thing.

**Decide first:** which bundle ID the app keeps. This page uses the existing parent app's
`org.plainphone.parent`. If you choose `org.plainphone.app` instead, replace the prefix everywhere
before sending, because Apple grants each entitlement to one bundle ID. See
[architecture.md](architecture.md#bundle-ids).

## Before you start

1. Sign in at [developer.apple.com/account](https://developer.apple.com/account) as the Account
   Holder (only the Account Holder can request managed capabilities).
2. Open **Certificates, Identifiers & Profiles → Identifiers**
   ([direct link](https://developer.apple.com/account/resources/identifiers/list)).
3. Make sure these App IDs exist. Create the missing ones with **+ → App IDs → App**, type
   **App**, "Explicit" bundle ID, and a description:

   | Description | Bundle ID |
   |---|---|
   | Plainphone | `org.plainphone.parent` (exists) |
   | Plainphone Activity Monitor | `org.plainphone.parent.activity-monitor` |
   | Plainphone Shield Configuration | `org.plainphone.parent.shield-configuration` |
   | Plainphone Shield Action | `org.plainphone.parent.shield-action` |
   | Plainphone Activity Report | `org.plainphone.parent.activity-report` |
   | Plainphone Location Push | `org.plainphone.parent.location-push` |

4. Create the App Group `group.org.plainphone.parent` under **Identifiers → App Groups**, and tick
   **App Groups** on all six App IDs.

The texts below are in English, which Apple's review team reads. They describe the app as it is
planned; nothing in them promises a feature that is not in [architecture.md](architecture.md).

## 1. Family Controls (distribution), five requests

Apple: "Request the Family Controls entitlement at family-controls-distribution. If your app
includes a Screen Time API app extension such as Device Activity Monitor, Device Activity Report,
Shield Action, or Shield Configuration, submit the same request for the extension."
([Requesting the Family Controls entitlement](https://developer.apple.com/documentation/familycontrols/requesting-the-family-controls-entitlement))

Send one request for the app and one for each of the four Screen Time extensions: five requests.
The Location Push extension does not use Family Controls and needs no request here.

**Where:** [developer.apple.com/contact/request/family-controls-distribution](https://developer.apple.com/contact/request/family-controls-distribution).
Apple also accepts the request from the **Capability Requests** tab of the App ID in
Certificates, Identifiers & Profiles ([Capability requests](https://developer.apple.com/help/account/capabilities/capability-requests/)).

**Steps:**

1. Open the link above and sign in.
2. Pick the team if asked.
3. Fill in the fields below, once per bundle ID.
4. Submit, and write down the date. There is no SLA: developers report a day to more than two
   months, and extensions are often slower than the app.
5. Check the status: **Identifiers → (the App ID) → Capability Requests**. When approved, Family
   Controls shows **Assigned**. Click the info button and check that **Provisioning Support** lists
   both **App Store** and **TestFlight** (whether TestFlight needs it is unverified).

**Fields (unverified) and text:**

- **App name:** `Plainphone`
- **Bundle ID:** one of the five below.
- **App Store URL:** leave empty (the iPhone app is not in the App Store yet), or the parent app's URL
  if it has been published by then.
- **Is the app a parental control app?** Yes.
- **Describe how your app uses the Family Controls entitlement** (paste for the app,
  `org.plainphone.parent`):

> Plainphone is an open-source (Apache-2.0) parental control app for families who want their child's
> phone to be a calm, simple phone first: calls and messages with approved people, a few approved
> apps, school time and bedtime. It is free and has no ads, no tracking and no in-app purchases.
> The same app has a parent role and a child role. On the child's iPhone, a parent in the same
> Family Sharing group authorizes Plainphone with AuthorizationCenter.requestAuthorization(for:
> .child). Plainphone then uses ManagedSettings to shield every app except the ones the parents
> approved, to block app installation and removal while no install has been approved, to lock
> accounts and the passcode, and to require automatic date and time. DeviceActivity schedules apply
> school time and bedtime and enforce daily time limits with a five-minute warning. On the parent's
> iPhone, FamilyActivityPicker lets the parent choose the child's approved apps. The child sees
> every rule in the app ("What can my parents see?"), and Plainphone never hides that it is
> installed. Rules come from the family's Plainphone server, which the family can host themselves.
> Source: https://github.com/plainphone/plainphone

- **Text for each extension** (change the first sentence per bundle ID):

  - `org.plainphone.parent.activity-monitor`:

> This is the Device Activity Monitor extension of Plainphone (org.plainphone.parent), a parental
> control app. It receives intervalDidStart and intervalDidEnd for school time and bedtime and
> eventDidReachThreshold for daily time limits, and applies or lifts the matching ManagedSettings
> stores that the app compiled from the parents' rules. It makes no network requests.

  - `org.plainphone.parent.shield-configuration`:

> This is the Shield Configuration extension of Plainphone (org.plainphone.parent), a parental
> control app. It shows a calm, Plainphone-styled shield that tells the child why an app is
> unavailable (not approved, school time, bedtime or time used up) and offers "Ask for more time".
> It makes no network requests.

  - `org.plainphone.parent.shield-action`:

> This is the Shield Action extension of Plainphone (org.plainphone.parent), a parental control
> app. When the child taps "Ask for more time" on a shield, it records the request in the app's App
> Group and posts a local notification that opens Plainphone, where the child sends the request to
> the parents. It makes no network requests.

  - `org.plainphone.parent.activity-report`:

> This is the Device Activity Report extension of Plainphone (org.plainphone.parent), a parental
> control app. It shows the child (and an adult using the app for themselves) their own screen time
> per day inside the app. The data stays on the device and is not sent anywhere.

## 2. Critical Alerts

Decision: apply now; until Apple grants it, SOS and "Ring the phone" use Time Sensitive
notifications, which the app already has.

**Where:** [developer.apple.com/contact/request/notifications-critical-alerts-entitlement](https://developer.apple.com/contact/request/notifications-critical-alerts-entitlement/)
(linked from Apple's [Critical Alerts entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.usernotifications.critical-alerts) page).

**Steps:** open the link, sign in, fill in the fields below for `org.plainphone.parent`, submit.
When granted, the entitlement `com.apple.developer.usernotifications.critical-alerts` appears for the
App ID; phase 3 adds it to `app.config.ts`. Apple grants it rarely: whether a family safety app
qualifies is unverified.

**Fields (unverified) and text:**

- **App name:** `Plainphone`
- **Bundle ID:** `org.plainphone.parent`
- **App Store URL:** as above.
- **Category:** choose the closest to personal safety (for example "Public Safety" or "Other").
- **Describe how the app uses critical alerts:**

> Plainphone is a free, open-source parental control app. A child can raise an SOS from their phone
> when they are in danger or need help; the SOS includes the child's position if the family has
> turned location sharing on. The parents' iPhones must sound that alert even when they are muted or
> in a Focus, because a missed SOS can mean a child in danger is not answered. Critical alerts are
> used only for (1) an SOS sent by the child and (2) "Ring the phone", which a parent uses to find a
> child who does not answer, on the child's own iPhone. Every other notification (requests,
> summaries, rule confirmations) stays a normal or Time Sensitive notification. Each family can
> switch both uses off per phone. There is no marketing, and the alerts are sent only by the family's
> own Plainphone server.

## 3. Location Push Service Extension

**What:** the entitlement `com.apple.developer.location.push`, "to enable a location-sharing app to
query someone's location in response to a push notification"
([entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.location.push),
[creating the extension](https://developer.apple.com/documentation/corelocation/creating-a-location-push-service-extension)).

**Where:** Apple's current entitlement page only says to add the **Location Push Service Extension**
capability in Xcode. Earlier it needed a request form at
[developer.apple.com/contact/request/location-push-service-extension](https://developer.apple.com/contact/request/location-push-service-extension/)
**(unverified that it is still required)**.

**Steps:**

1. Open **Identifiers → `org.plainphone.parent` → Capabilities** and look for **Location Push
   Service Extension**. If it can be ticked, tick it and save; that is all.
2. If it is not listed or says it needs approval, open the request link above and send the text
   below.

**Text:**

> Plainphone is a free, open-source parental control app with a parent role and a child role. A
> parent can press "Find" to see where their child's iPhone is, and a parent can send an "Are you
> okay?" check-in; if the child does not answer by the deadline, the child's phone sends one position.
> The child's iPhone answers these requests with a Location Push Service Extension
> (org.plainphone.parent.location-push), which gets one location fix and sends it to the family's
> Plainphone server. Location sharing is off until the parents turn it on, it requires Always
> authorization that the child sees being granted, the child can see every request in the app, iOS
> shows its location indicator, and only the latest position is kept on the server.

## 4. App and Website Usage (EU, iOS 26.4)

**What:** `com.apple.developer.family-controls.app-and-website-usage`, needed for
`FamilyActivityData` (real bundle IDs and visited domains), which customer installs can use only
"on devices located in the EU that are signed in with an Apple Account with an EU country or
region" ([FamilyActivityData](https://developer.apple.com/documentation/familycontrols/familyactivitydata)).
Applicable: most Plainphone families are in Denmark, Sweden, Norway and Germany. Norway is not in the
EU, so Norwegian families get tokens only.

**Where:** Apple's page says "Enable the capability on your Xcode target". Whether distribution needs
a separate request, and where, is **unverified**. Check **Identifiers → `org.plainphone.parent` →
Capabilities** for **Family Controls (App and Website Usage)**; if it says it needs approval, use the
**Capability Requests** tab.

**Text (if a request is needed):**

> Plainphone (org.plainphone.parent) is a free, open-source parental control app. In the EU we want
> parents to approve their child's apps by name in the family's web dashboard, as they can on
> Android, instead of only through the picker on an Apple device. With the child's and parent's
> approval (approvedWithDataAccess), the child's iPhone reads installedApplications to send the
> bundle IDs of installed apps to the family's own Plainphone server, where the parent approves
> them. The feature is off until the family turns it on, the child is told in the app what is shared,
> and the data is used only for approving apps. Visited web domains are not collected.

## After sending

- Record each request (bundle ID, date sent, form used) in the issue for #163, so later phases know
  what is pending.
- Apple's answers arrive by email to the Account Holder and in Certificates, Identifiers &
  Profiles. Nothing in the repo changes until a phase adds the entitlement to `app.config.ts`.
