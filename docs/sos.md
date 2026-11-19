# SOS

On a Child phone, open **SOS** from the Plainphone home screen, or from **Today**
in light mode. Hold **Urgent** or **I need help** for three seconds. The ring
shows progress. With a screen reader, activate the action and choose **Confirm**
to start the same timed countdown. After the hold, you have five seconds to
undo. Both kinds alert parents. Urgent uses higher-priority push and also
starts a regular phone call after the report has been accepted or handed to
the carrier for SMS sending.

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

The child sees when Plainphone accepted the report or which contacts the phone
submitted SMS messages for. The child can also see when a parent presses
**I've seen it**. The phone polls for acknowledgment while SOS is open. Acknowledging
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

The background delivery job starts the urgent call even when the SOS screen
is closed. The phone records that the call has been handled only after a call
has actually started. If it cannot start (the phone is already in a call, the
call permission is missing), the job tries again for ten minutes without
reporting the alert a second time. After that the SOS screen tells the child
that the call did not start and suggests calling a parent or 112. Urgent tries the next parent after 30 seconds without an answer,
or sooner when Android reports the first attempt ended. **Stop calling** cancels
escalation. Escalation requires Plainphone to hold the dialer role. If Android
does not let Plainphone observe the call, Plainphone only attempts the first
parent. If voicemail answers, Android sees the call as answered and the phone
stops trying. Calls use the phone network.

The server limits ordinary help reports to five reports per phone in ten
minutes. When an over-limit help report was already submitted by SMS, the
server keeps it in history. Urgent reports above the limit still create
distinct events and run through delivery. A repeated client ID keeps its
original event.

The server tracks delivery for each parent in the household (`sos_deliveries`):
whether they were sent a push, a mail, or neither was possible. A retry, which
runs one minute after a failed round and after an interrupted dispatch, only
repeats what failed for the parents who have not been reached, so a parent who
already got the alert does not get it again. Each push and mail send is bounded
(20 seconds, shorter than the 2 minute dispatch reservation) and is recorded
the moment it succeeds. A parent counts as done when any channel reached them,
or when nothing could reach them (no push registration and no mail). The
incident closes when every parent is done, or when a parent has acknowledged it.
If a parent is still unreached six hours after the server received the report, the server stops, records
`delivery_failed_at`, and the dashboard shows that the alert did not reach
every parent. Temporary push errors during these retries never count toward a
subscription's failure limit; only a permanent error (an invalid or unregistered
token) removes a subscription. A provider may accept a notification just before
the server stops, so recovery can deliver that notification again.

## Push configuration

Urgent SOS uses the app's native push path (see [push setup](push-setup.md)):
on Android it is a high-priority FCM message on the **Urgent SOS** channel, and on
iOS an APNs alert marked Time Sensitive (the app carries the Time Sensitive
Notifications entitlement). A parent can allow the channel through Do Not Disturb
on Android, or allow it in Focus settings on iOS. User and system notification
controls still apply. Help SOS uses the normal channel.

The server needs no extra configuration for SOS: it uses the FCM and APNs settings
from push setup, and browser push uses the existing VAPID config. Both kinds also
send the transactional email, so a parent without push still hears about it.
Native push shows the phone's name and the alarm type, like every other alert. The
SOS history in the signed-in dashboard holds the details. When a parent signs out,
the server removes the registrations of that session (see
[push setup](push-setup.md)), so the install stops receiving SOS alerts, and the app
clears delivered notifications.

## Privacy

SOS attaches a single position when local rules allow location, Android has
location enabled and the first delivery attempt can get a recent fix near
the original SOS. Later retries reuse that position when sharing still allows
it. The server checks sharing again before keeping the fix. SOS does not update the general location feed.
Coordinates are only in the alert history and the fallback SMS if it is sent.
The dashboard opens Google Maps only after a parent taps the map link.
The server deletes the event after 30 days or when the phone is removed.
See [privacy](privacy.md).
