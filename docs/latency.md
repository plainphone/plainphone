# How fast alerts and wake-ups travel

An SOS is only as good as the time it takes to reach a parent. This page lists every path a
message takes, what decides its delay, what we expect, and what the server measures so the
expectation can be checked against real phones. The server's numbers are public at
[`GET /api/latency`](../server/openapi.yaml) and the dashboard shows one line of them in a child
phone's health card: "Alerts usually arrive within N s". Operators can scrape the full picture
(p50 and p95 per path and provider, failures) from [`/api/metrics`](#operator-metrics).

The expected times below come from the platforms' documentation and from how our code schedules
work. They are not measurements. Replace them with the p50/p95 from `/api/latency` once real
phones have run for a week (see [Test on real phones](#test-on-real-phones)).

## The paths

### 1. Child phone to server (SOS, code word, quick message, callback request)

| | |
|---|---|
| Decides the delay | The 5-second undo window (by design), then: one position lookup (at most 2 s, cached fixes count), the report over HTTPS (4 s read timeout), and on failure the SMS fallback and retries. |
| Before this change | The first attempt was an ordinary WorkManager job. With the screen on it usually ran within a second or two, but the job scheduler may hold ordinary jobs back for Doze, app standby buckets and battery saver. Retries backed off exponentially from 30 s. |
| Now | The first attempt starts the moment the undo window ends: an ordinary SOS in a short foreground service with a visible "Sending your SOS to your parents…" notice, a silent SOS quietly in the app's process with a partial wake lock (a notice would give it away). The WorkManager job is still queued, now expedited, as the safety net across restarts; a lock makes it wait for the first attempt and then find the work done. Retries back off linearly from 10 s, and a new network retries a waiting SOS at once. The SMS fallback is unchanged. |
| Expected | Best about 0.3 s after the undo window, typical 1 to 3 s (most of it the position), worst: no network, so the SMS goes at once and the online report follows within 10 s of the network coming back. |
| Measured as | `phone-server`, per `kind` (`sos`, `quick`, `callback`). The phone sends `X-Plainphone-Elapsed-Ms`, the time since the press on its monotonic clock, so a wrong phone clock does not matter. Without it (older app, reboot in between) the server uses `sentAt`. Only the first arrival of a report counts; one already sent by SMS is not timed. |

### 2. Server to parent devices

The server answers the phone first and then sends to every parent and every channel at the same
time (push to each device and the mail, in parallel; one database round trip fetches the phone,
the parents and what has already been delivered). SOS retries run first in the minute sweep, so
slow DNS or a failing clean-up never holds one up.

Each notification gets a class, and each provider gets the matching settings
([`server/src/lib/push-priority.ts`](../server/src/lib/push-priority.ts)):

| Class | Used for | FCM | Web Push | APNs | TTL |
|---|---|---|---|---|---|
| alarm | Urgent SOS, code word, hidden SOS, lost protection | `priority: HIGH`, channel **Urgent SOS** | `Urgency: high` | `apns-priority: 10`, `interruption-level: time-sensitive` | 24 h |
| prompt | Help SOS, quick messages, "I'm home", ring and "Are you okay?" answers, requests, approvals, test | `priority: HIGH` | `Urgency: high` | `apns-priority: 10` | 4 h |
| normal | Requests to be called back (not urgent: the SOS itself is), and everything else (weekly summary, offline notices, silent follow-ups) | `priority: NORMAL` | `Urgency: normal` | `apns-priority: 5` | 24 h |

Every APNs request sets `apns-push-type: alert` and `apns-expiration` (without it APNs tries once
and drops the alert when the phone is unreachable). FCM alerts carry no collapse key: FCM keeps
only four collapse keys per device and an SOS must never be the one dropped; the tag still replaces
a shown notification. Web Push uses the tag as `Topic`, so a newer update replaces an undelivered
older one. iOS Critical Alerts (sound through silent mode) need an Apple entitlement that has been
requested but not granted; until then `time-sensitive` is the strongest level.

| Provider | Decides the delay | Expected |
|---|---|---|
| Web Push | The browser's push service and whether the browser runs. Chrome on Android goes through FCM. | Typical 1 to 3 s with the browser open or on Android; a closed desktop browser gets it when it next starts, within the TTL. |
| FCM (Android parent app) | High priority wakes the phone from Doze. Aggressive battery managers (some Xiaomi, Huawei, Samsung settings) can still hold it. | Typical under 1 to 3 s; a phone without network gets it when it is back, within the TTL. |
| APNs (iOS parent app) | Priority 10 is sent at once. While a phone is offline APNs keeps only the newest notification per app. | Typical about 1 s. |
| Mail | The mail provider and the parent's mail app. | Seconds to minutes; it is the channel for parents without push. |

Measured as `server-parent` (from the SOS reaching the server, or the event happening, to the push
service accepting the message; a retry counts its wait) and `parent-device` (the same plus the time
until the parent's device confirms it arrived), per provider. The device confirms with a receipt:
each push carries a random 22-character `receipt` id, and the device posts it to
`POST /api/push-receipt` when the notification arrives (the web service worker always; the native
app when it is running) and when it is opened. The receipt needs no sign-in and says nothing about
the message.

On Android the **Urgent SOS** channel in the parent app plays the default sound, vibrates long, is
readable on the lock screen and asks to pass Do Not Disturb. Android only honours that after the
parent allows it: **Settings → Urgent SOS sound and Do Not Disturb** in the app opens the channel's
system settings. A full-screen intent (the alarm-clock style screen) is not used: Android 14 and
Google Play reserve it for calling and alarm apps.

### 3. Server to the child phone

A parent's change, a ring, an "Are you okay?", Find, an app update or the acknowledgement of an SOS
wakes the phone, which then runs its ordinary authenticated sync (the wake carries no content). How
fast depends on the transport:

| Transport | Decides the delay | Expected |
|---|---|---|
| FCM (`fcm`) | A high-priority data message starts an expedited sync (an ordinary immediate sync on Android 10 and 11, where WorkManager would need a foreground notice for expedited work). Android may treat high-priority messages that never show a notification as normal priority after a while. TTL: ring (start and stop) and Find 2 min, SOS acknowledgement 10 min, rules and "Are you okay?" 15 min, app update 1 h. All wakes share one collapse key, so a burst of changes is one wake. | Typical 1 to 5 s including the sync. |
| UnifiedPush (`unifiedpush`) | The distributor (for example ntfy) keeps its own connection; `Urgency: high` and the same TTLs. | Typical 1 to 5 s; depends on the distributor's connection. |
| Polling (`poll`) | The [timing table](phone-sync.md#when-the-phone-syncs): screen on every 60 s, an open ring or "Are you okay?" every 10 s, screen off every 2 minutes, which deep Doze stretches to 9 to 15 minutes. | Screen on: up to 1 min. Screen off: up to 2 min, in deep Doze up to 15 min. |

Measured as `server-child`, per transport: from the first wake-up a phone has not answered yet to
its next rules fetch. A burst of changes counts once, from its first change. A wake-up answered
more than 30 minutes later (twice the slowest polling interval) is dropped: the phone was off or
without signal, which says nothing about how fast push is.

**Faster rule updates** (push wake-ups) is now on by default for a new Android phone when the server
can wake phones (`PUSH_PROVIDER` is `fcm` or `unifiedpush` with a usable provider). Phones paired
earlier keep their setting. Parents can switch it off per phone in the dashboard and the parent app;
the phone then relies on polling only, and still gets everything, just later.

## What is stored

One row per timing in `latency_samples`: the path, the provider, the class or kind, the hour
(rounded down) and the durations in milliseconds. No message, no user, no phone: an open wake-up
holds the phone's id only until the phone answers it, and a parent push holds its random receipt id
for at most a day. Rows are deleted after 8 days. `/api/latency` reports the last 7 days and leaves
out every path with fewer than 5 samples, so it never describes a single event. It never shows the
sample counts either: on a server with one family the count would tick up with every SOS. The
response is cached for a minute.

Self-hosters can switch it all off with `LATENCY_STATS=off`: nothing is recorded, pushes carry no
receipt id, `/api/latency` answers `enabled: false`, and the dashboard line disappears. This is a
server switch rather than a per-phone one because the numbers belong to the server's delivery
chain, not to a phone or a family.

```json
{ "enabled": true, "windowDays": 7, "minSamples": 5, "paths": [
  { "path": "phone-server", "provider": null, "kind": "sos", "p50Ms": 1400, "p95Ms": 2900 },
  { "path": "parent-device", "provider": "fcm", "kind": null, "p50Ms": 900, "p95Ms": 3100 }
] }
```

The dashboard's line is the median of `phone-server` (`sos`) plus the slowest provider's median
for `parent-device`, rounded up to whole seconds. It shows nothing until confirmed deliveries
exist. The parent app can only confirm an FCM or APNs alert that arrives while it is open (Android
and iOS show a background alert without waking the app), so `parent-device` for `fcm` and `apns`
leans on foreground deliveries and may read a little faster than a phone in a pocket. Web Push
receipts come from the service worker and cover the background too.

## Operator metrics

`/api/latency` is public and leaves out thin paths. An operator who wants to see whether "live" is
actually fast reads `GET /api/metrics` instead: Prometheus text, behind `Authorization: Bearer
<METRICS_TOKEN>`. Without `METRICS_TOKEN` the endpoint answers 404 as if it did not exist; a wrong
token gets 401 (and 429 after ten wrong guesses a minute from one IP). Scraping and the ready
Grafana dashboard ([`deploy/grafana/plainphone-latency.json`](../deploy/grafana/plainphone-latency.json))
are in [self-hosting.md](self-hosting.md#watching-delivery-speed).

| Metric | Labels | Meaning |
|---|---|---|
| `plainphone_latency_ms` | `path`, `provider`, `kind`, `window`, `quantile` (`0.5`, `0.95`) | Delivery time in milliseconds. Paths as above: `phone-server` (with `kind` `sos`, `quick`, `callback`), `server-parent`, `parent-device`, `server-child`. |
| `plainphone_latency_samples` | `path`, `provider`, `kind`, `window` | How many timings the numbers rest on. |
| `plainphone_push_failures_total` | `provider` | Pushes that failed since the server started (counter): alerts to parents, and wake-ups of child phones (`fcm`, `unifiedpush`). |
| `plainphone_mail_sent_total`, `plainphone_mail_refused_total` | `reason` (`cap`, `provider`) on refused | Mails handed to the mail server, and mails not sent because of the server's mail cap or a temporary (4xx) refusal by the mail server, since start-up ([operations.md](operations.md#mail-caps)). |
| `plainphone_mail_counted`, `plainphone_mail_cap` | `window` (`hour`, `day`) | Mails counted towards the cap in the current UTC hour and day, and `MAIL_HOURLY_CAP` / `MAIL_DAILY_CAP` (`0`: no cap). |

`provider` is `fcm`, `apns`, `webpush`, `unifiedpush` or `poll`; `window` is `1h` or `24h`. Samples
are stored by clock hour, so a window reaches back to the start of the hour it begins in: `1h` is the
current and the previous clock hour, `24h` the current and the previous 24. Unlike `/api/latency`,
thin groups are shown, with their sample count next to them; read the count before the number.

Aggregates only: the labels above are all there is, so no household, phone, user, endpoint or
receipt id can be told apart, and nothing grows with the number of families. `LATENCY_STATS=off`
leaves the page without timings and counts no failures.

What it does not cover:

- **SMS fallback.** The child phone sends the SMS itself, and an SOS already sent that way is not
  timed (see path 1), so the server has nothing to measure or count. Only the report that follows
  online is timed.
- **Wake-up failures** are counted only when the server sees them: an FCM error, a UnifiedPush
  answer other than success, or a timeout. A push the provider accepted and never delivered is
  invisible here; the `server-child` timings thin out instead.
- **Push failures** are counted in the server's memory, so the counter starts at 0 after a restart
  (use `increase()`, as the dashboard does), and a failed push that is retried counts once per
  attempt. A subscription the push service has removed is not a failure.

## Test on real phones

Use a test child phone (strong mode, paired, SOS parents set) and a parent phone with the parent
app signed in and notifications allowed. There is nothing to time by hand: the server measures.

1. On the server, check `GET /api/health` (push providers on) and note `GET /api/latency`.
2. Parent phone: in the app's Settings, open **Urgent SOS sound and Do Not Disturb** and allow it to
   override Do Not Disturb.
3. Screen on: send a help SOS and an urgent SOS from the child phone. Note when the parent phone
   rings.
4. Screen off: lock both phones and leave them still for 2 minutes. Send a hidden SOS (power button)
   from the child phone. Note when the parent phone rings.
5. Doze: with both phones unplugged and still, force deep Doze over adb with
   `adb shell dumpsys deviceidle force-idle` (on each phone in turn), then repeat step 4. Leave idle
   with `adb shell dumpsys deviceidle unforce`.
6. Battery saver: switch on battery saver on both phones and repeat steps 3 and 4.
7. Child wake-ups: with the child phone's screen off, ring it and send an "Are you okay?" from the
   parent app; repeat with **Faster rule updates** off to see polling.
8. Flight mode on the child phone, send an SOS (the SMS goes out), switch flight mode off and check
   that the report arrives within seconds.
9. After the tests, `GET /api/latency` shows the paths once each has 5 samples; send a few more
   rounds if needed.

## Not done yet

- The native parent app only confirms arrival while it is running; a notification the system shows
  in the background confirms when it is opened. A background notification task would close the gap.
- Android lets an app set a channel's sound, vibration and Do Not Disturb wish only when the channel
  is first created. A parent app installed before this change keeps its old **Urgent SOS** channel
  settings until it is reinstalled (or the parent changes them in the channel's settings).
- iOS Critical Alerts wait for Apple's entitlement.
- A self-hosted ntfy for UnifiedPush is being set up separately; the server side is ready for it.
- The public status page (status.plainphone.org, Uptime Kuma) does not show these numbers yet; it
  can link or embed `/api/latency`.
