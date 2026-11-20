# Asking for more time, and the 5-minute warning

Two small features on top of [time limits](time-limits.md). Both can be switched off per phone
and both default to on.

| Switch | Default | What it does |
|---|---|---|
| **Warn 5 minutes before** (`limitWarningEnabled`) | on | A quiet notice on the phone 5 minutes before an app, or the daily limit, runs out |
| **Allow asking for more time** (`askMoreTimeEnabled`) | on | The stop screen has one friendly button to ask for more time |

Both switches are in the dashboard and in the parent app (Screen time). They reach the phone in
`GET /device/rules`; a missing field means on, so an older server never turns them off by
accident.

## Why

A refusal with no way forward invites a fight or a workaround. The Digital Services Act
guidelines for minors (¶81(a)) say a refusal should offer a way forward, and mediation research
finds that rules which are explained and can be talked about work better than rules that
simply stop things ([design principle 5](design-principles.md)). The warning gives the child
time to finish what they are doing, so the stop is not a surprise. Phone calls, messages,
parents, 112 and help lines never count towards a limit and are never stopped, so none of this
touches them.

## The 5-minute warning

- The phone counts use and evaluates the limits itself, offline ([time-limits.md](time-limits.md)).
  When an app has 5 minutes or less left, or the total does, and it is the one that runs out
  first, the phone shows a calm line: "5 minutes left in Spotify today". It never counts down.
- At most one warning per app (or for the daily limit) per day.
- No sound, no vibration. It is a silent, low-importance notification, and a one-line banner at
  the top of Plainphone's own home screen.
- Not during bedtime or other quiet windows, and never for core apps.
- Switch **Warn 5 minutes before** off and the phone shows nothing.

## Asking for more time

1. When an app's time (or the daily limit) is used up, the stop screen keeps its reason, **Back
   to start** and **Call or message a parent**, and adds one friendly action: **Ask for more
   time**. The child can add a short reason (up to 140 characters, optional).
2. The phone sends `POST /device/more-time-requests`. If it is offline, the request is kept on
   the phone and sent when it is online again.
3. The parents get a push notification with the choices **15 min**, **1 hour**, **Rest of the
   day** and **No**. The same request is in the dashboard (the phone's page) and in the parent
   app, so it can be answered from any of them.
3b. A parent standing next to the child can approve it on the phone itself: **My requests** lists
   the ask, and **A parent is here: approve with PIN** (the same PIN box as for apps and contacts,
   [bedtime.md](bedtime.md)) gives **15 minutes**. It shows as "approved on the phone" in the
   dashboard and the parents are told. It follows the per-phone switch **Allow approval with PIN on
   the phone**; more than 15 minutes is a choice for the dashboard or the parent app.
4. The first answer wins. A second parent, or a second tap, sees what was decided and changes
   nothing (`won: false`).
5. The phone shows the state: sent, waiting, approved (with the new end time, or "the rest of
   the day"), declined, or no answer yet. A request nobody answers expires at the phone's local
   midnight. A request also ends as `expired` (no bonus, `won: false`) when a parent answers after
   the phone stopped being a child's phone or the limit was removed; the dashboard and the parent
   app then say it expired, not that someone else answered.

An approval is an ordinary time bonus for that one app (or for the daily limit when that is
what ran out), for that day only, like the bonus in Family Link. It reaches the phone through
`timeLimits.bonuses` in the rules, so the phone applies it even if the request call was lost.
"Rest of the day" adds the minutes left until local midnight at the time of the answer, so there
is no hidden extra minute: what the parent chose is what is added.

The phone is the authority for what it has already done. The server never refuses a report; the
request itself is only a question, so it can be refused (switched off, no such limit, too many).

### Limits that keep it calm

- One open request per app (or daily limit) at a time: asking again returns the open one and
  does not notify the parents again.
- At most 6 new requests an hour (asking again for an open one does not count) per phone.
- Answered requests are deleted after 30 days (the reason is text the child wrote).
- Only child phones can ask. On a Self phone there is nobody to ask.
- A muted phone ([notifications](parent-app.md)) sends no push, but the request still appears
  in the dashboard and the parent app.

## Answering from the notification

| Where | How |
|---|---|
| Dashboard (Web Push) | The notification has action buttons. A tap sends the answer from the service worker with the browser's session, without opening the page. If that fails, a notification says so and opens the phone's page. |
| Parent app, Android (FCM) | A data message that the app turns into a notification with the same four buttons. |
| Parent app, iOS (APNs) | The push has the category `more-time`; the app registers the four actions for it. A button opens the app briefly to send the answer, as on Android. |

Browsers show a limited number of action buttons (`Notification.maxActions`). A browser that
shows fewer than four keeps **15 min** and **No**; tapping the notification itself opens the
phone's page, where all four choices are.
On Android and iOS the button opens the app briefly to send the answer (the app has no background task for it, and a closed iOS app would otherwise drop the answer). Action buttons on native pushes need the parent app to have been opened once since it was
installed (it registers the notification category then).

### A receipt for an answer from a notification

A parent who answers with a button should not have to wonder whether it worked. Every answer path
(Web Push in the dashboard, the parent app on Android and iOS) gives the same three things:

1. **Right after the tap**, the notification is replaced by a short, silent one (same `tag`): what was
   answered ("15 more minutes given") and "The phone will confirm when it is active."
2. **When the phone has applied it**, the server updates that notification once more, silently and
   under the same tag: "15 more minutes given. Active on the phone at 14:05" (the wording of the
   dashboard's rule receipt, in the phone's time zone; "The phone confirmed the rules at …. Check the
   time on the phone." when the phone's clock is ahead). It is sent when a status report proves the phone
   holds the current rules, which now include the bonus. Only the parent who answered from a
   notification gets it, only for 15 minutes, 1 hour and the rest of the day (a "No" changes nothing on
   the phone), and not after 6 hours.
3. **When it goes wrong**, a normal notification says so in plain words and a tap opens the phone's
   page: "This request had expired", "Could not answer, open Plainphone" (signed out, offline, or
   refused). If another parent was first, their answer is shown, not an error: "Already answered by
   another parent: 60 more minutes given".

It follows the switches that already exist. **Change receipts** (per phone, [sync API](sync-api.md))
off means the follow-up promises nothing and no receipt is sent. A muted phone sends nothing. The
dashboard's service worker sends `source: "notification"` with the answer; answering in the page or the
parent app's request list does not, and gets no extra notification.

## API

Phone (device token):

- `POST /device/more-time-requests` with `{ "packageName": "*" | "<package>", "reason": "…" }`.
  `*` is the daily limit. `201` created, `200` the open request for the same target, `403`
  switched off, `409` not a child phone or no limit on the target, `429` too many.
- `GET /device/more-time-requests` the last 24 hours, newest first.

A request is `{ id, packageName, reason, day, status: pending|approved|declined|expired, answer:
"15"|"60"|"day"|"no"|null, grantedMinutes, createdAt, decidedAt }`.

Parents (session or cookie):

- `GET /phones/{pid}/more-time-requests` open and the last 24 hours, with `appLabel` (null for
  the daily limit) and `answeredByYou`.
- `POST /phones/{pid}/more-time-requests/{rid}/answer` with `{ "answer": "15"|"60"|"day"|"no", "source"?: "notification" }`.
  Always `200` with the request as it stands and `won`; `404` unknown, `409` when the limit was
  removed in the meantime.
- `PATCH /phones/{pid}` accepts `askMoreTimeEnabled` and `limitWarningEnabled`. The phone summary
  has both and `openMoreTimeRequests`.

Contract: [`server/openapi.yaml`](../server/openapi.yaml). Server code: `services/more-time.ts`,
`routes/more-time.ts`, words in `lib/more-time-words.ts`. Table: `more_time_requests` (migration `0041_more_time.sql`; `0044_more_time_receipt.sql` adds who waits for the receipt).

## Notes for self-hosters

- The new migrations are additive. Nothing to configure. Android parent apps get a quiet "Updates" notification channel for the receipt.
- The "more time" notification text and its buttons are in English, Danish, Swedish, Norwegian
  and German (the parent's language). All other alerts and mails are too (`server/src/lib/push-text.ts`), and
  fall back to English only when the language is unknown. The parent app and the dashboard show all five languages
  once opened.
- Without Web Push, FCM or APNs configured ([push setup](push-setup.md)) the request still shows
  in the dashboard and the parent app; there is just no notification.
