# Permission declarations (draft)

Texts for the declaration forms Play Console asks for when the phone app's Play edition is
uploaded, and the in-app disclosures Google requires before Android's own permission screens.
The policies behind each one are in [policy-review.md](policy-review.md). All forms are in
English; Google reviews in English.

The parent app needs none of these. It asks only for the camera (pairing QR code) and
notifications.

General rules for every video (from the policy pages, read 22 November 2026):

- record a real Android phone, not an emulator frame of an iPhone and not the iOS app,
- show the app being opened, the in-app disclosure (scroll slowly if it is long), the choice
  to agree, Android's permission screen, and the feature working,
- also show **Not now**, and how the disclosure comes back later,
- keep it short (30 seconds or less for location, 90 seconds or less for the VPN), unlisted on
  YouTube or a Drive link that does not need a login,
- use a test household and invented names only. No real child, no real numbers.

The in-app disclosure texts below are drafts in English. Before they ship they need Danish,
Swedish, Norwegian and German versions in `values-*/strings.xml`, and they are product changes
(not part of this documentation change).

## Accessibility service

**Form:** Play Console → App content → Accessibility API.

| Question | Answer |
|---|---|
| Is your app an accessibility tool (`isAccessibilityTool`)? | No |
| Why does your app need the Accessibility Services API? | App functionality |
| Do you collect and/or share personal or sensitive data using the accessibility capabilities? | Yes |
| What user data? | App activity: Installed apps; App activity: Other actions (minutes used in apps that have a time limit) |

**Description for the form:**

> Plainphone is a parental control app. A parent installs it on their child's phone and chooses
> which apps the child can use and for how long. The Plainphone guard (an AccessibilityService)
> sees which app comes to the front. When the app is not allowed, or its time is used up, the
> guard sends the phone to the home screen and shows a screen that explains why and how to ask a
> parent. The guard also reads text on Android Settings pages to recognise the pages where
> Plainphone itself would be switched off or uninstalled, and closes those pages, as the
> policy allows for apps authorised by a parent through a parental control app. Screen text is
> only used on the phone and is never sent anywhere. The only data that leaves the phone is the
> list of installed apps (so the parent can allow them) and the minutes used in apps that have
> a time limit. The guard does not act on its own: it follows fixed rules the parent set.

**In-app disclosure (separate screen, before "Switch on the guard"):**

> **Plainphone guard**
>
> The guard sees which app is open. If it is an app your parent has not allowed, or its time is
> up, the guard closes it and shows why.
>
> To keep Plainphone switched on, the guard also reads the text on some Android settings pages.
> That text stays on this phone.
>
> Your parent can see which apps are on the phone and how many minutes you used apps that have
> a time limit.
>
> [Agree and continue] [Not now]

**Video:** open Plainphone → setup → the disclosure → **Agree** → Android's accessibility
settings → switch on Plainphone guard → back in Plainphone → open an app that is not allowed → the
stop screen. Then a second take with **Not now** and the step still open on the Today screen.

## SMS and Call Log

**Form:** Play Console → App content → Sensitive app permissions → SMS and Call Log.

| Permission | Core functionality |
|---|---|
| `READ_SMS`, `RECEIVE_SMS`, `RECEIVE_MMS`, `RECEIVE_WAP_PUSH`, `SEND_SMS` | Default SMS handler |
| `READ_CALL_LOG`, `WRITE_CALL_LOG`, `CALL_PHONE`, `ANSWER_PHONE_CALLS` | Default Phone handler |

**Description for the form:**

> Plainphone replaces the phone and messages apps on a child's phone so that the child can call
> and text the contacts their parents approved, and always 112 and the parents. It asks Android
> for the default Phone and default SMS roles with Android's own role dialogs during setup, and
> only then for the related permissions. It provides the full in-call screen
> (InCallService), call screening, the recent calls list, SMS conversations (existing picture
> and group messages are shown as placeholders) and the keypad. Calls and messages from numbers that are not approved are blocked. The call log and
> messages stay on the phone and are never uploaded; the parent sees only the rules they set.
> When Plainphone is no longer the default handler, the parent is told that calls and messages
> are no longer filtered.

**Video:** setup → the default Phone app dialog → the default SMS app dialog → call an approved
contact from Plainphone → receive and answer an SMS in Plainphone's Messages → show a call
from an unknown number being blocked.

## Background location

**Form:** Play Console → App content → Sensitive app permissions → Location permissions.

| Question | Answer |
|---|---|
| Main purpose of the app | Parental control: a calm phone for a child with rules set by the parents |
| Feature that needs location in the background | Find: a parent asks where the phone is, and the phone answers even when Plainphone is not open |
| Why foreground location is not enough | The child is not using Plainphone when the parent asks; the request arrives as a push and the phone must answer then |

**Description for the form:**

> When a parent taps "Find" in the Plainphone parent app, the child's phone gets the request and
> reports one position. The child sees a notice on the phone each time. A parent can also turn
> on "Are you okay?" check-ins and an SOS button that include the position. Continuous sharing
> ("always on") is off by default for a child and shows an ongoing notification while on.
> Plainphone keeps only the latest position per phone and deletes it when location is switched
> off. Location is never used for ads or analytics.

**In-app disclosure (before Android's location dialog), in the form Google prescribes:**

> **Location for Find**
>
> Plainphone collects location data to enable Find, check-ins and the SOS button even when the
> app is closed or not in use.
>
> Each time your parent asks where the phone is, you see a notice. Only the latest position is
> kept.
>
> [Allow location] [Not now]

**Video (30 seconds or less):** setup → the disclosure → **Allow location** → Android's dialog →
"Allow all the time" → close Plainphone → on a second device, tap Find in the parent app → the
position appears and the notice shows on the child's phone.

## VpnService

**Form:** Play Console → App content → VPN service.

| Question | Answer |
|---|---|
| Is providing a VPN the core functionality? | No |
| Permitted functionality | Parental control |
| Does the VPN service collect or share data? | Yes: web browsing (the host names looked up), processed in memory by the filter and not stored |

**Description for the form:**

> Plainphone's web filter is a local VPN that carries only DNS lookups. It has no default
> route, so other traffic does not pass through it. Each lookup is forwarded over DNS-over-TLS
> to the family's Plainphone DNS filter, which blocks the categories the parent chose. The filter
> keeps no query log and anonymises client addresses. The VPN does not inspect, log or redirect
> any other traffic and is never used for ads or monetisation. Its use is described in the store
> listing.

**In-app disclosure (separate screen, before Android's VPN dialog):**

> **Web filter**
>
> Plainphone uses a VPN on this phone to check the names of websites before they open. Only the
> names go through it, not what you see or type.
>
> Sites your parent has blocked do not open. The filter does not keep a list of the sites you
> visit.
>
> [Turn on the filter] [Not now]

**Video (90 seconds or less):** setup → the disclosure → Android's VPN dialog → the key icon
in the status bar → open a blocked site in Chrome → it does not load → open an allowed site.

## Foreground services

**Form:** Play Console → App content → Foreground service permissions.

| Type | Used by | Description |
|---|---|---|
| `mediaPlayback` | `safety/RingService` | A parent can make the phone ring loudly to find it; the sound plays until the child stops it. Video: tap "Ring" in the parent app, the phone rings with a notification and a stop button |
| `shortService` | `sos/SosSendService` | Sends an SOS the child started, with a notification, and stops when it has been delivered |
| `systemExempted` | `update/InstallWatchdogService` | Not in the Play edition (self-updates and strong mode only) |

## Full-screen intent

**Form:** Play Console → App content → Full-screen intent. Answer: the app's core functionality is
**receiving phone calls** (it is the default Phone app), so the permission is granted
automatically.

## Monitoring flag and listing text

Not a form, but checked in review: the Play edition's manifest needs
`<meta-data android:name="isMonitoringTool" android:value="child_monitoring" />`, and the
store description must say what the parent can see. The drafted listings in
`fastlane/metadata/android/` have a paragraph for this, for the guard and for the VPN.
