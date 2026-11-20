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

## Why SOS has no on/off switch

Most Plainphone features can be turned on and off per phone. SOS is deliberately
an exception, like 112 and the parents' own reachability: it is the child's way
to reach their parents, and a parent switching it off would remove that. What a
parent can set is who gets called and texted, and the callback number.

The phone is the authority for what it has already done. The server records
every report the phone sends, including one that says an SMS was sent, even if
the phone has since been released or is over the help limit. Over the limit
(5 help requests in 10 minutes) the report is stored but does not notify again.

## Hidden SOS and quick messages

Some situations call for an alert nobody nearby notices. Parents and child agree
on which of these to use, and each one has its own switch in the dashboard and the
parent app (**Hidden SOS** and **Quick messages** on a Child phone's page). The
SOS itself can be silent, but its existence is not a secret from the child: the
phone's **What can my parents see?** page lists which hidden ways are on and which
quick messages are code words (design principle 1).

| Switch | Default | What it does |
|---|---|---|
| **Power button** (`hiddenPower`, `hiddenPresses`) | off, 4 presses | Pressing the power button 3–6 times (the parents choose) within about three seconds sends a silent urgent SOS, also with the screen off and the phone in a pocket |
| **Hold the clock** (`hiddenClock`) | off | Holding the clock on the home screen for 1.5 seconds sends a silent urgent SOS |
| **Quiet confirmation** (`hiddenFeedback`) | short vibration | One 60 ms vibration after a hidden SOS, or nothing |
| **Quick messages** (`quickMessagesEnabled`) | off (on for phones paired before the [family inbox](family-inbox.md)) | Up to six short messages the parents write, sent with one tap from the SOS screen and from Messages (in the [family inbox](family-inbox.md) when it is on) |
| **Child can suggest messages** (`quickSuggestionsEnabled`) | on | The child suggests a new quick message; a parent approves or declines it |

A silent SOS is an urgent SOS with a position when location sharing allows it, as
above, but the phone makes no sound, shows nothing and does not start a call. The
parents' alert says how it was sent. It uses the same delivery, retries, SMS
fallback and acknowledgment as any SOS. The phone is the authority: the server
records a hidden SOS even if the parents have switched that way off since.

**The power button and Android's own Emergency SOS.** Android 12 and later have
an Emergency SOS gesture that starts a countdown, an alarm and a call to 112 after
five presses of the power button (some manufacturers use other counts). A Device
Owner can neither switch it off nor read whether it is on:
`DevicePolicyManager.setSecureSetting` only accepts `DEFAULT_INPUT_METHOD`,
`SKIP_FIRST_USE_HINTS` and `LOCATION_MODE`, and the gesture's setting is not
readable for apps. Plainphone therefore defaults to **four** presses, so the two
do not collide. Choosing five or six presses can start Android's emergency call as
well. The child can still call 112 from the keypad, the SOS screen and the lock
screen. The press count is taken from screen on/off events while the Plainphone
process runs; a phone's camera double-press shortcut can add presses, so test the
gesture on the child's phone together.

**Quick messages.** When the list is empty, the dashboard offers three to start
with ("Pick me up", "I'm okay", "Call me"). An ordinary quick message goes to the
parents' devices as a normal push when the phone is online. If no parent device got
the push, or the phone is offline, it goes as an ordinary SMS to the SOS parents.
More than ten quick messages in ten minutes are recorded but quiet: no push and no
SMS. The child sees "Sent to your parents" at once; if the message turns out not to
reach anyone (no push, and no SMS could be sent), that changes to "The message could not be sent".

**Code words.** A parent can mark a quick message as a code word. On the child's
phone it looks and behaves exactly like any other quick message. The parents get an
urgent SOS alarm with the text and a position. If the phone cannot reach the server,
the fallback SMS is only the text (plus a map link when there is a position), so it
looks ordinary too, and the report follows online as soon as possible.

**Suggestions.** At most three suggestions wait at once. A parent can approve a
suggestion as an ordinary message or as a code word, or decline it. A declined
suggestion is deleted.

Privacy: quick messages sent from the SOS screen are not stored as history (in the [family inbox](family-inbox.md) they are, for at most 30 days). The server keeps only
the id of an online quick message for a day, to recognise a retry. A hidden SOS is
an SOS event like the others (30 days), with how it was sent and a code word's text.

The fallback SMS is written in the phone's language (da, en, sv, nb, de), from Android string resources. A hidden SOS says "(hidden SOS)" in every language, so the parent knows not to call back loudly.

Self-hosting: update the server before the phone app. An older server rejects the
`trigger` and `message` fields of a hidden SOS report, and the phone does not fall
back to SMS after a rejection.


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

The phone sends an authenticated report with a unique UUID the moment the undo
window ends: an ordinary SOS in a short foreground service that shows "Sending
your SOS to your parents…" on the **SOS** notification channel, a silent SOS
without any notice. If online reporting fails, the default SMS app attempts one
SMS per selected number and queues the same UUID for an online retry.
WorkManager persists the retry across restarts (expedited, then every 10, 20,
30 … seconds), and a new network retries a waiting SOS at once. Expected and
measured delivery times are in [latency.md](latency.md).
The server deduplicates the report even when the first response was lost. The
SMS handoff is reserved in local storage before dispatch to prevent a retry
from repeating it after a crash. A carrier handoff can fail, and neither an
accepted online report nor a submitted SMS proves a parent has received it.
A parent may receive an SMS plus the queued report's later email and push.
When the server refuses the report for good (a 4xx other than 404: the phone was
released or removed in the dashboard and has not synced yet, or a proxy rejects
it), or the phone has no usable device token, the SMS and the urgent call to the
parents still go out. Neither needs the server. Once the SMS has gone out, the
phone reports once more saying so: the server records an SOS that was sent by
SMS whatever the phone's state, so it still shows in the dashboard and the
parents get the push.

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
Notifications entitlement). Both keep an undelivered alert for 24 hours. The
Android channel plays the default sound, vibrates long and shows on the lock
screen; a parent can allow it through Do Not Disturb from the parent app's
**Settings → Urgent SOS sound and Do Not Disturb**, or in Focus settings on iOS.
User and system notification controls still apply. Help SOS uses the normal
channel at high priority. Web Push sends both with `Urgency: high`. The server
sends to every parent's devices and the mail at the same time.

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
