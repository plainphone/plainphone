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
| Dashboard (Web Push) | The notification has action buttons. A tap sends the answer from the service worker with the browser's session, without opening the page. If that fails, the phone's page opens. |
| Parent app, Android (FCM) | A data message that the app turns into a notification with the same four buttons. |
| Parent app, iOS (APNs) | The push has the category `more-time`; the app registers the four actions for it. A button opens the app briefly to send the answer, as on Android. |

Browsers show a limited number of action buttons (`Notification.maxActions`). A browser that
shows fewer than four keeps **15 min** and **No**; tapping the notification itself opens the
phone's page, where all four choices are.
On Android and iOS the button opens the app briefly to send the answer (the app has no background task for it, and a closed iOS app would otherwise drop the answer). Action buttons on native pushes need the parent app to have been opened once since it was
installed (it registers the notification category then).

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
- `POST /phones/{pid}/more-time-requests/{rid}/answer` with `{ "answer": "15"|"60"|"day"|"no" }`.
  Always `200` with the request as it stands and `won`; `404` unknown, `409` when the limit was
  removed in the meantime.
- `PATCH /phones/{pid}` accepts `askMoreTimeEnabled` and `limitWarningEnabled`. The phone summary
  has both and `openMoreTimeRequests`.

Contract: [`server/openapi.yaml`](../server/openapi.yaml). Server code: `services/more-time.ts`,
`routes/more-time.ts`. Table: `more_time_requests` (migration `0040_more_time.sql`).

## Notes for self-hosters

- The new migration is additive. Nothing to configure.
- The "more time" notification text and its buttons are in English, Danish, Swedish, Norwegian
  and German (the parent's language). The other alerts are still English and Danish only, and
  fall back to English for the rest. The parent app and the dashboard show all five languages
  once opened.
- Without Web Push, FCM or APNs configured ([push setup](push-setup.md)) the request still shows
  in the dashboard and the parent app; there is just no notification.
