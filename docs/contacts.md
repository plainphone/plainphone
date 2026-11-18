# Approved contacts (phase 2)

Plainphone is the phone's default **phone app** and **SMS app**. Child phones
limit calls and text messages to approved numbers. New Self phones allow
everyone by default and can limit calls and texts to favourites during schedules.
Emergency numbers always work.

This page describes how that is built, where Android sets the limits, and what is not covered yet.

## Existing history

The Calls and Messages tabs read the Android system providers on the phone. Calls
and SMS can be browsed in pages, including entries from previous default apps
that still exist in the providers. Opening an SMS conversation loads its newest
messages first. An MMS in a one-to-one conversation appears as a placeholder
alongside the SMS messages from that conversation. Group MMS conversations are
read-only, with placeholders for the attachments.
Conversations and call entries for numbers the child cannot contact are read-only.
The history is limited to the Android providers. Chats stored only in an app,
including private RCS conversations, cannot be imported.

## Child contact suggestions

When a paired Child phone grants contacts access, Plainphone reads phone entries
from the Android address book, including synced accounts, and groups each
contact's international numbers in a single suggestion. The dashboard offers **Approve**,
**Dismiss** and **Approve all**. Only approved numbers can be called and texted.
Suggestions refresh with phone sync, including edits and deletions. Approval
covers the suggestions shown on the web dashboard or in the parent app. If a
suggestion changes before review, the updated suggestion stays pending. A reviewed
number does not come back, even if the name changes or the phone reports the
same address book again. The child can see what is shared on the Contacts tab. See [Privacy](privacy.md).

## Self favourites

The Contacts tab shows local contacts and favourites. After pairing in setup and
later from **Choose favourites** in Contacts, pick contacts that should always
be reachable. On the dashboard, **Favourites** lets you turn on the optional
restriction for active schedules. When it is on, favourites can still call and
text in both directions, alongside emergency and helpline exceptions. Adding a
favourite after enabling the restriction, or turning the restriction off, waits
for the Self key. Removing a favourite applies at once. Strong Self phones
already paired before this update keep their always-on list restriction.
Switching to scheduled restrictions or allowing everyone requires the Self key.

On an unrestricted Self phone, choose **New message** in Messages to text a
number you have not saved.

App time limits keep telephony available as a core function. A scheduled
favourites restriction applies during the active schedule, including while
app time limits are in effect.

## How it works

| Piece | Android API | What it does |
|---|---|---|
| Default phone app | `RoleManager.ROLE_DIALER`, set by `DevicePolicyManager.setDefaultDialerApplication` (Device Owner, Android 14+; on Android 10 to 13 through Android's role dialog, see [android-versions.md](android-versions.md)) | Plainphone's in-call service gets every call on the phone |
| Call screening | `CallScreeningService` (bound for the default phone app) | Incoming calls from numbers that are not approved, and from hidden numbers, are rejected before the phone rings. No ring, no notification, no call log entry |
| In-call service | `InCallService` | Ends outgoing calls to numbers that are not approved, **whoever started the call** (Plainphone's keypad, the maker's dialer, a `tel:` link in Chrome, a contact card). Also a second check on incoming calls |
| Default SMS app | `RoleManager.ROLE_SMS`, set by `DevicePolicyManager.setDefaultSmsApplication` | Only the default SMS app receives `SMS_DELIVER` and may write the SMS store |
| Incoming SMS | `SMS_DELIVER` receiver | Messages from approved contacts are stored and shown. Others are dropped and never stored. Only the sender and time go to Plainphone's local blocked log, never the text |
| Outgoing SMS | `SmsManager` | Plainphone's own message screen only sends to approved contacts. "Reply with a message" on the incoming-call screen (`RESPOND_VIA_MESSAGE`) checks the list too |
| MMS | `WAP_PUSH_DELIVER` receiver | Required for the SMS role. **Phase 2 drops MMS and group messages** and logs that one arrived. See "Not covered yet" |
| Maker's phone and SMS apps | `setApplicationHidden` | Hidden once Plainphone holds the role (on Android 10 to 13 the extra dialers are hidden even before, see [android-versions.md](android-versions.md)), except the system dialer (see "Emergency calls") and apps the parent allowed in the QR code. "SMS app" means an app that can receive `SMS_DELIVER`, not every app that opens `smsto:` links (WhatsApp does) |

When the phone is set up by QR code, Plainphone takes both roles itself before setup ends, and grants its own runtime permissions (`setPermissionGrantState`). If Android refuses a role, the status screen says so (`FAIL default phone app`), nothing telephony-related is hidden, and the rest of the lock still holds. When Device Owner is released on the maintenance screen, the roles go back to the system dialer and the maker's SMS app.

The rule is enforced while the phone is locked in strong mode or while paired
light-mode protection is active. During a maintenance unlock or before light
mode has finished setup, Plainphone works as an ordinary phone and SMS app.

## Emergency calls

Emergency calls must never fail because of Plainphone. That is handled in four layers:

1. **Always allowed numbers.** 112, 911 and 114 (Danish police, non-urgent) can be called and texted on every phone, even with an empty list. Only outgoing: an incoming call or SMS showing "112" as sender is treated like any other unknown number, because caller IDs are easy to spoof. Real call-backs are covered by point 3.
2. **The phone's own list.** Every number that Android reports as an emergency number for the current SIM and network (`TelephonyManager.isEmergencyNumber`, for example 999, 000, 110, 119) is allowed. If that lookup fails, 112, 911 and 114 still work.
3. **Call-back window.** After an outgoing emergency call **that connected**, every incoming call is let through for 60 minutes, also from hidden numbers. Dialling and hanging up before the call connects does not open it, and neither does 114 (not an emergency service), so a child cannot use it to open the phone. Calls Android marks as emergency call-backs (`PROPERTY_EMERGENCY_CALLBACK_MODE`) are always let through. Emergency services often call back from numbers that are not on any list. The window is measured on Android's monotonic clock and is tied to the current boot, so changing the date cannot reopen it. Only incoming calls are opened: no outgoing calls or messages to strangers.
4. **The system dialer is never hidden.** Android falls back to the system dialer (`TelecomManager.getSystemDialerPackage`) if the default phone app crashes during an emergency call, and the lock screen's emergency dialer belongs to the telephony system. Plainphone hides the maker's other dialers and SMS apps, but not that one. Calls started from it still go through Plainphone's in-call service, which ends calls to numbers that are not approved.

Plainphone never ends a call to a number Android treats as an emergency number, nor a call Android flags as an emergency (`PROPERTY_NETWORK_IDENTIFIED_EMERGENCY_CALL`, `PROPERTY_EMERGENCY_CALLBACK_MODE`). The lock screen's emergency button does not go through Plainphone's screens at all.

If Plainphone itself fails while screening a call (an exception in the policy code), the call is let through. A bug must not make the phone unreachable for the parents.

## Phone numbers

Numbers are compared in one normalized form ([`PhoneNumbers.kt`](../android/app/src/main/java/org/plainphone/app/contacts/PhoneNumbers.kt)), so `12 34 56 78`, `+45 12345678` and `0045-12-34-56-78` are the same number on a Danish phone. National numbers are expanded with the phone's country code: from the QR code (`--country-code 45`) if given, else from the SIM, else from the network. The national trunk prefix is dropped where the country has one (Germany `030…` → `+4930…`). Italy keeps its leading 0. Numbers of six digits or fewer are compared as they are (service codes). Text senders ("Netflix"), `*#06#`-style codes and hidden numbers never match a contact.

Only about 25 countries are in the table. A phone in another country needs every contact stored with its `+country code`. libphonenumber would cover every country but adds about 4 MB; that is a decision for when Plainphone is used outside Europe.

## Where the list comes from

`ContactPolicySource` ([`ContactPolicySource.kt`](../android/app/src/main/java/org/plainphone/app/contacts/ContactPolicySource.kt)) is the only way the app reads the rules:

```kotlin
interface ContactPolicySource {
    fun rules(): ContactRules   // enforced?, approved contacts, home country
}
```

Phase 2 has one implementation, `LocalContactPolicySource`, which keeps the list in the app's private storage:

- **QR code:** `--contact 'Mum=+45 12 34 56 78'` (repeatable) and `--country-code 45`. The script refuses a number without `+` unless `--country-code` is given. The list in the QR code is only used the first time; scanning again never wipes changes made on the phone. If a number cannot be expanded during setup (no country yet), it waits and is added as soon as the phone knows its country.
- **Maintenance screen:** tap "Version" seven times, enter the PIN, then "Approved contacts and blocked log". Add or remove contacts and see what was blocked. The screen closes as soon as it is left, so the PIN is needed again.

Once paired, the synced source uses the approved list from the parent's
dashboard or the Self phone's favourites. The last rules keep applying
offline. The emergency and helpline checks are shared by both sources.

## The blocked log

Blocked calls and messages are logged on the phone (newest 100): time, call or message, direction, and the number. Message text is never stored. The log is only visible on the PIN-protected screen and is never sent anywhere in phase 2.

## Not covered yet

- **New MMS and group messages** are dropped, also from approved contacts. Downloading MMS needs the carrier's MMSC settings and a PDU parser; that comes later. The messages screen says so.
- **RCS (chat features).** RCS needs Google Messages as the default SMS app. With Plainphone as the SMS app, RCS is off and messages fall back to SMS. Senders using RCS see that the phone "only supports SMS".
- **Messenger apps.** WhatsApp, Signal, Messenger, Snapchat and similar apps have their own calls and chats. No Android API lets a third party filter them. They are not on the allowlist by default, and allowing one of them is a separate choice. The contacts screen says this plainly.
- **Voicemail.** The carrier's voicemail number is a normal number and must be added as a contact to be callable. Visual voicemail is not handled.
- **Messaging apps the parent allows.** An app allowed in the QR code (`--allow`) stays visible even if it can be an SMS app. Allowing Google Messages that way lets it send SMS directly and pair with Messages for web, so do not allow it.
- **Other apps with SMS permissions.** Since Android 10 the SMS permissions are hard-restricted: only the default SMS app and apps the installer allow-lists can hold them. A few preinstalled apps (carrier apps, sometimes the assistant) may still hold them and could send or read SMS without Plainphone. Plainphone does not take the permissions away from system apps, because that can break the phone's own SMS handling. Checklist row C18 tests it.
- **Contacts app.** The maker's contacts app stays visible (it is a core app). Adding a contact there does not approve it, and calls started from it are checked like any other call.
- **USSD codes** (`*100#` for balance) are blocked, because they are not approved numbers. Add them as a contact if they are needed.
- **Dual SIM**: messages are stored with their SIM, but the screens do not show or choose the SIM yet.
- **Not tested on hardware.** Everything above is unit-tested on the JVM and under Robolectric, but has not run on a real phone yet. Samsung's and Xiaomi's phone apps may behave differently around roles and screening. See [bypass-checklist.md](bypass-checklist.md), section "Calls and messages".
