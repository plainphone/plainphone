# Approved contacts (phase 2)

Plainphone is the phone's default **phone app** and **SMS app**. Calls and text messages only go to and come from the numbers on the approved list. Emergency numbers always work.

This page describes how that is built, where Android sets the limits, and what is not covered yet.

## How it works

| Piece | Android API | What it does |
|---|---|---|
| Default phone app | `RoleManager.ROLE_DIALER`, set by `DevicePolicyManager.setDefaultDialerApplication` (Device Owner, Android 14+) | Plainphone's in-call service gets every call on the phone |
| Call screening | `CallScreeningService` (bound for the default phone app) | Incoming calls from numbers that are not approved, and from hidden numbers, are rejected before the phone rings. No ring, no notification, no call log entry |
| In-call service | `InCallService` | Ends outgoing calls to numbers that are not approved, **whoever started the call** (Plainphone's keypad, the maker's dialer, a `tel:` link in Chrome, a contact card). Also a second check on incoming calls |
| Default SMS app | `RoleManager.ROLE_SMS`, set by `DevicePolicyManager.setDefaultSmsApplication` | Only the default SMS app receives `SMS_DELIVER` and may write the SMS store |
| Incoming SMS | `SMS_DELIVER` receiver | Messages from approved contacts are stored and shown. Others are dropped and never stored. Only the sender and time go to Plainphone's local blocked log, never the text |
| Outgoing SMS | `SmsManager` | Plainphone's own message screen only sends to approved contacts. "Reply with a message" on the incoming-call screen (`RESPOND_VIA_MESSAGE`) checks the list too |
| MMS | `WAP_PUSH_DELIVER` receiver | Required for the SMS role. **Phase 2 drops MMS and group messages** and logs that one arrived. See "Not covered yet" |
| Maker's phone and SMS apps | `setApplicationHidden` | Hidden once Plainphone holds the role, except the system dialer (see "Emergency calls") |

When the phone is set up by QR code, Plainphone takes both roles itself before setup ends, and grants its own runtime permissions (`setPermissionGrantState`). If Android refuses a role, the status screen says so (`FAIL default phone app`), nothing telephony-related is hidden, and the rest of the lock still holds. When Device Owner is released on the maintenance screen, the roles go back to the system dialer and the maker's SMS app.

The rule is only enforced while the phone is locked: Plainphone is Device Owner and no maintenance unlock is running. During a maintenance unlock, or on a phone where Plainphone is installed by hand, it works as an ordinary phone and SMS app.

## Emergency calls

Emergency calls must never fail because of Plainphone. That is handled in four layers:

1. **Always allowed numbers.** 112, 911 and 114 (Danish police, non-urgent) are allowed on every phone, in every direction, even with an empty list.
2. **The phone's own list.** Every number that Android reports as an emergency number for the current SIM and network (`TelephonyManager.isEmergencyNumber`, for example 999, 000, 110, 119) is allowed. If that lookup fails, 112, 911 and 114 still work.
3. **Call-back window.** After an outgoing emergency call, **every incoming call is let through for 60 minutes**, also from hidden numbers. Emergency services often call back from numbers that are not on any list. The window is measured on Android's monotonic clock and is tied to the current boot, so changing the date cannot reopen it. Only incoming calls are opened: no outgoing calls or messages to strangers.
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

- **QR code:** `--contact 'Mum=+45 12 34 56 78'` (repeatable) and `--country-code 45`. The list in the QR code is only used the first time; scanning again never wipes changes made on the phone.
- **Maintenance screen:** tap "Version" seven times, enter the PIN, then "Approved contacts and blocked log". Add or remove contacts and see what was blocked. The screen closes as soon as it is left, so the PIN is needed again.

Phase 3 adds a source that syncs the list from the parent's dashboard and swaps it in at `ContactPolicySources.get`. Nothing else in the app needs to change.

## The blocked log

Blocked calls and messages are logged on the phone (newest 100): time, call or message, direction, and the number. Message text is never stored. The log is only visible on the PIN-protected screen and is never sent anywhere in phase 2.

## Not covered yet

- **MMS and group messages** are dropped, also from approved contacts. Downloading MMS needs the carrier's MMSC settings and a PDU parser; that comes later. The messages screen says so.
- **RCS (chat features).** RCS needs Google Messages as the default SMS app. With Plainphone as the SMS app, RCS is off and messages fall back to SMS. Senders using RCS see that the phone "only supports SMS".
- **Messenger apps.** WhatsApp, Signal, Messenger, Snapchat and similar apps have their own calls and chats. No Android API lets a third party filter them. They are not on the allowlist by default, and allowing one of them is a separate choice. The contacts screen says this plainly.
- **Voicemail.** The carrier's voicemail number is a normal number and must be added as a contact to be callable. Visual voicemail is not handled.
- **Contacts app.** The maker's contacts app stays visible (it is a core app). Adding a contact there does not approve it, and calls started from it are checked like any other call.
- **USSD codes** (`*100#` for balance) are blocked, because they are not approved numbers. Add them as a contact if they are needed.
- **Dual SIM**: messages are stored with their SIM, but the screens do not show or choose the SIM yet.
- **Not tested on hardware.** Everything above is unit-tested on the JVM and under Robolectric, but has not run on a real phone yet. Samsung's and Xiaomi's phone apps may behave differently around roles and screening. See [bypass-checklist.md](bypass-checklist.md), section "Calls and messages".
