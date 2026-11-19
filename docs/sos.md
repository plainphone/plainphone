# SOS

On a Child phone, open **SOS** from the Plainphone home screen, or from **Today**
in light mode. Hold **Urgent** or **I need help** for three seconds. The ring
shows progress. After the hold, you have five seconds to undo. Both kinds alert
parents. Urgent uses higher-priority push and also starts a regular phone call
after the report has been accepted or handed to the carrier for SMS sending.

**Call 112** opens Android's emergency dialer after a three-second hold. It
also works without pairing, a data connection or an approved contact list.
The regular keypad and Android's lock-screen emergency control are still
available. On a Myself phone the SOS screen offers 112 only. A trusted approver
for rules is not necessarily an emergency contact, and Myself has no dedicated
SOS recipients in this release.

## Set up recipients

1. In the Child phone's **Contacts**, select **Use for SOS calls and SMS** on
   each approved parent contact. No existing contacts are selected automatically.
   The phone tries the selected parents in name order. The selected numbers
   remain available under the ordinary approved-contact rules.
2. In the Child phone's **SOS history**, save the child's own phone number in
   international format to make **Call back** available.
3. Enable browser push or **SOS notifications** on each parent's device. Every
   parent account in the household is included in SOS push and email when
   those services are configured.

The child sees the last send time and can see when a parent presses **I've
seen it**. The phone polls for acknowledgment while SOS is open. Acknowledging
creates one timestamp per event and leaves the event in history.
Parents can include the name their child knows them by when acknowledging.

## Delivery and phone calls

The phone sends an authenticated report with a unique UUID. If online reporting
fails, the default SMS app attempts one SMS per selected number and queues the
same UUID for an online retry. WorkManager persists the retry across restarts.
The server deduplicates the report even when the first response was lost. The
SMS handoff is reserved in local storage before dispatch to prevent a retry
from repeating it after a crash. A carrier handoff can fail, and neither an
accepted online report nor a submitted SMS proves a parent has received it.
A parent may receive an SMS plus the queued report's later email and push.

Urgent tries the next parent after 30 seconds without an answer, or sooner
when Android reports the first attempt ended. **Stop calling** cancels
escalation. Escalation requires Plainphone to hold the dialer role. If Android
does not let Plainphone observe the call, Plainphone only attempts the first
parent. If voicemail answers, Android sees the call as answered and the phone
stops trying. Calls use the phone network.

The server limits ordinary help reports to five reports per phone in ten
minutes. When an over-limit help report was already submitted by SMS, the
server keeps it in history. Urgent reports above the limit still create
distinct events and run through delivery. A repeated client ID keeps its
original event.

## Push configuration

Android's **Urgent SOS** channel uses a distinct sound and requests permission
to bypass Do Not Disturb where Android allows it. A parent can allow the
channel in Android's Do Not Disturb settings. On iOS the push is Time Sensitive
and the parent can allow it in Focus settings. User and system notification
controls still apply.

Native push requires an Expo project, APNs/FCM credentials and a native app
build. Set `PLAINPHONE_EXPO_PROJECT_ID` for the app build and, on Android,
`PLAINPHONE_GOOGLE_SERVICES_FILE` to the path to the FCM client config.
`EXPO_ACCESS_TOKEN` on the server authenticates requests if the Expo project
requires it. Browser push uses the existing VAPID config. Both kinds use the
existing transactional email layout.

## Privacy

SOS attaches a single position when local rules allow location, Android has
location enabled and the phone can get a recent fix. The server checks sharing
again before keeping the fix. SOS does not update the general location feed.
Coordinates are only in the alert history and the fallback SMS if it is sent.
The dashboard opens Google Maps only after a parent taps the map link.
The server deletes the event after 30 days or when the phone is removed.
See [privacy](privacy.md).
