# Data safety answers (draft)

Draft answers for the Data safety form in Play Console, one set per app. They come from
[privacy.md](../privacy.md), [account-deletion.md](../account-deletion.md), the manifests and the
server code as of `origin/main` on 22 November 2026. Google's definitions are on
[Provide information for Google Play's Data safety section](https://support.google.com/googleplay/android-developer/answer/10787469)
(read 22 November 2026). Change this page and [privacy.md](../privacy.md) together.

Rules from that page that decide the answers below:

- Data that stays on the phone is not "collected". So the call log, SMS and MMS, the blocked
  log and the held-for-review messages are not declared.
- Data sent to a **service provider** that processes it for us (hosting, push services, the
  DNS upstreams) is not "sharing".
- Data the user chooses to send to another person (a message, an SOS) is not "sharing" either.
- Data processed only in memory for one request ("ephemeral") is entered in the form but not
  shown on the listing.
- "Encrypted in transit" can only be ticked if **all** collected data is. Every connection to
  `app.plainphone.org` and the DNS filter uses TLS; the SOS fallback SMS is sent by the user to
  the parents' phones and is not data we collect.
- The deletion badge applies: accounts can be deleted in the app and on the web, and most
  history is deleted automatically within 30 days.

The service is a test version, and the server can read what it stores. End-to-end encryption is
planned ([encryption.md](../encryption.md)); until it ships, nothing may be declared as exempt
because of it.

## Answers common to both apps

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes |
| Do you provide a way for users to request that their data is deleted? | Yes: in the app (Settings → Delete my account) and at the web link below |
| Data deletion web link | `https://plainphone.org/delete-account/` |
| Privacy policy | `https://plainphone.org/privacy/` |
| Is data shared with third parties? | No. Mail, push and DNS upstreams are service providers; Google Play Billing (phone app, Play edition, off today) is a payment processor |
| Independent security review | No |
| Families / target audience | 18 and over |

## Parent app (`org.plainphone.parent`)

| Data type (Play category) | Collected | Why (Play purpose) | Optional? | Retention (from privacy.md) |
|---|---|---|---|---|
| Email address (Personal info) | Yes | Account management, App functionality | Required | Until the account is deleted |
| User IDs (Personal info): the numeric Google account ID, only if the parent turns on reset protection | Yes | App functionality | Optional | Until disconnected, the account is deleted or the household is deleted |
| Phone number (Personal info): SOS callback and parent numbers, approved contacts the parent types in | Yes | App functionality | Optional | Until removed or the phone is removed |
| Name (Personal info): names the parent types for contacts, phones and extended family | Yes | App functionality | Optional | Until removed |
| Contacts (Contacts): approved contacts entered by the parent | Yes | App functionality | Optional | Until removed or the phone is removed |
| Other in-app messages (Messages): replies in the family inbox, quick messages | Yes | App functionality | Optional | Newest 50 per phone, at most 30 days |
| Other user-generated content: rules, phone names, request answers | Yes | App functionality | Required | Until the phone is removed |
| Device or other identifiers: push token (FCM) | Yes | App functionality (notifications) | Optional | Until the parent turns notifications off, signs out or the token fails |
| Photos or videos: the camera is used to read a pairing QR code | **No**: the image is decoded on the device and never sent | | | |
| Location: the parent app shows the child phone's position | **No** for the parent app itself: it is collected by the phone app and declared there. The map tiles request (OpenFreeMap) sees the area and the parent's IP address; enter it as ephemeral if asked | | | |
| Crash logs, diagnostics, analytics, advertising ID | No | | | |

## Phone app (`org.plainphone.app`, Play edition)

The Play edition is light mode with the Child profile only ([policy-review.md](policy-review.md#what-the-phone-app-needs-before-play)).
"Optional" means a switch in the parent dashboard or a step the phone can skip; every feature
can be switched off, except reaching 112 and the parents.

| Data type (Play category) | Collected | Why (Play purpose) | Optional? | Retention |
|---|---|---|---|---|
| Precise location (Location) | Yes | App functionality (Find, SOS, check-ins) | Optional; "always on" is never the default for a child | Latest position only, until location is switched off or the phone is removed; SOS position 30 days; a shared snapshot one hour |
| Approximate location | Yes (same reports) | App functionality | Optional | As above |
| Installed apps (App activity): the list of launchable apps with names, so the parent can allow them | Yes | App functionality | Required | Until the phone is removed |
| App interactions (App activity): minutes per app and day for apps with a time limit, and for the weekly summary when it is on | Yes | App functionality | Optional | 21 days (summary input); weekly summaries 8 weeks |
| Other actions (App activity): requests for an app, a contact or more time, with the optional reason the child writes (a contact's name and number are declared under Personal info below) | Yes | App functionality | Optional | 30 days after they are decided |
| Contacts (Contacts): names and numbers from the phone's address book, only if the parent turns on contact suggestions | Yes | App functionality | Optional, off by default | Pending until reviewed or switched off; reviewed numbers until the phone is removed |
| Name and Phone number (Personal info): the name and number of a contact the child asks the parents to approve (a request for a contact), and approved SOS parent numbers and the child's SOS callback number | Yes | App functionality | Optional | Contact requests 30 days after they are decided; SOS numbers until removed or the phone is removed |
| Other user-generated content (Messages): the text of a hidden SOS code word, stored with the SOS event | Yes | App functionality | Optional, off unless the code word is set up | With the SOS event: 30 days |
| Other in-app messages (Messages): quick messages, family inbox, check-in answers, messages to extended family | Yes | App functionality | Optional | Newest 50, at most 30 days |
| SMS or MMS messages, call log | **No**: they stay on the phone | | | |
| Web browsing history | **No**: the DNS filter keeps no query log; counters only, without IP addresses, for 24 hours. Enter lookups as ephemeral if the form asks | | | |
| Device or other identifiers: device token, push token (FCM or UnifiedPush endpoint), the filter's random ClientID | Yes | App functionality | Required | Until the phone is removed |
| Diagnostics (App info and performance): battery, app and Android version, lock state, which protections are on, the latest system check | Yes | App functionality (the parent sees whether protection works) | Required | Each report replaces the last |
| Purchase history (Financial info): only if billing is switched on and a household buys through Google Play | Not today | (Billing is off, [billing.md](../billing.md)) | | Kept as bookkeeping law requires |
| Crash logs, analytics, advertising ID | No | | | |

### Accessibility, VPN and monitoring answers that must match

- The accessibility declaration says the guard collects **App activity: installed apps and
  app interactions** (minutes for time limits). Screen text the guard reads in Settings is
  used on the phone and never sent.
- The VPN declaration says the tunnel carries DNS only and that DNS names are not stored.
- The listing states that the phone reports its position and app use to the parents
  (Stalkerware rules). The drafted full descriptions in `fastlane/play/` do.
