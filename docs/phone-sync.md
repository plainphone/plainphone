# How the phone follows the parent's dashboard

The Plainphone app pairs with the server once and then keeps fetching the parent's rules:
app list, approved contacts, school time and bedtime, the DNS address and location. This page
describes the phone's side. The API contract is [sync-api.md](sync-api.md) and
[`server/openapi.yaml`](../server/openapi.yaml); the code is in
[`android/app/src/main/java/org/plainphone/app/sync/`](../android/app/src/main/java/org/plainphone/app/sync).

## Pairing

1. The QR code carries the server address (`plainphone.server_url`, default
   `https://app.plainphone.org`; self-hosters' dashboards put their own address in, and the script
   takes `--server-url`). Only `https://` is accepted, so the device token never travels in clear text.
2. **A QR code made in the dashboard** (*Add phone*) also carries a one-time enrollment token
   (`plainphone.enroll`). At provisioning the phone stores it sealed (like the device token) and,
   as soon as there is a network, sends it to `POST /device/enroll` together with a random install
   id. It gets its device token back and is paired with the phone entry the parent made, without a
   code. This runs on the pairing screen right after setup and in a background job with backoff
   (`EnrollWorker`), so it also works if nobody looks at the screen or the network comes late. A
   refused token (unknown, used, expired after 24 hours) is dropped and the phone falls back to a code.
   If the phone was already showing a code (it was offline when setup finished), it cancels that code
   on the server once the token has paired it, so typing the old code in the dashboard no longer
   creates a second phone entry. This is best effort: if the phone is offline again at that moment,
   the code simply expires after 15 minutes.
3. **Otherwise** (a QR code from the script, or the token was refused) the phone opens **Pair with
   a parent**: an 8-character code and a QR code. The parent scans it with their phone's camera (it
   opens the dashboard with the code filled in) or types the code under *Add phone*, *Type the code*.
   Codes live 15 minutes; the phone fetches a fresh one when a code runs out. The phone polls every
   3 seconds while the screen is open and receives its device token once.
4. The device token is sealed with an AES-256-GCM key in the Android Keystore before it is stored;
   the stored copy is useless on any other phone.

**Pairing needs the maintenance PIN except at setup.** A phone that has never been paired may
show its pairing screen without the PIN during the first hour after the lock was first
applied. After that, or once the phone has been paired, a new pairing only starts from the
PIN-protected maintenance screen. Otherwise a child (or a Self user who wants out of their key)
could pair the phone to an account of their own and open everything.

## When the phone syncs

| Trigger | How |
|---|---|
| Every 15 minutes | WorkManager periodic work, whenever there is a network (WorkManager's shortest period) |
| Boot, app update, pairing | One-time work right away |
| Network comes back | Default-network callback, at most once a minute |
| Screen on | Sync right away, then every `pollSeconds` (60 s) for as long as the screen stays on |
| Maintenance screen | *Sync with the server now* |
| Screen off | An `AlarmManager` alarm (allowed while idle) every 2 minutes, so a ring or an "Are you okay?" arrives without push |
| A ring or "Are you okay?" is open | Every `pollSeconds` (10 s), also with the screen off, so stops and answers travel fast |
| The "Are you okay?" deadline | An alarm at the deadline, then a sync that sends the one position |

So a parent's change, "Find", a ring or an "Are you okay?" reaches a phone that is in use within
about a minute, and a phone lying in a pocket within about 2 minutes while Android is not in deep
sleep. In deep Doze (screen off and still for a long time) Android stretches idle alarms to
about every 9 to 15 minutes, and WorkManager to 15 minutes or more. Push wake-ups (FCM or UnifiedPush,
**Faster rule updates**, on by default for new phones when the server can wake them) close that gap;
polling stays the guarantee, so phones without Google Play services work. Expected and measured
times per path are in [latency.md](latency.md).

One sync: report the installed apps if they changed, fetch the rules with `If-None-Match`, store
them, re-apply the lock if the merged result changed (or every 15 minutes anyway, which heals
changes made on the phone), answer "Find", report status. Package changes, new rules, process
startup, locale changes, and changes to the enabled keyboard packages or default SMS app can trigger a fresh
inventory scan. Otherwise, sync skips the scan for up to 24 hours after the
last successful check. An unchanged list needs no upload. See the [Android wakeup inventory](wakeups.md)
for the scheduling call sites.

Sync reuses HTTP connections. If an exchange fails with an I/O error, replayable reads,
safety events, release acknowledgements, and enrollment with the same token and install ID
get one retry on a fresh connection. The pairing poll can fetch the device token again for up
to 24 hours or until the first rules sync, but it starts on a fresh connection and has no
application-level retry.

## Never looser because of an error

- **Offline or server down:** the last rules stay in force. They are stored on the phone and
  survive reboots. Schedules keep switching on time, because they are evaluated on the phone.
- **A broken answer** (not JSON, missing fields, unknown time zone, bad weekday) is thrown away
  before it is stored; the last good rules stay.
- **Removed in the dashboard** (`401` with the server's `unknown device; pair again`; any other
  `401`, for example from a proxy, is retried like a server error): the phone keeps the last rules, stops polling and shows
  "pair again from the maintenance screen". Only its DNS goes back to the QR code's host, because
  the DNS service deletes a removed phone's ClientID (otherwise the phone would have no DNS).
- **During a maintenance unlock** the sync stores new rules but does not re-apply the lock;
  the unlock ends on its own timer as before.

## What the rules change on the phone

| Rule | On the phone |
|---|---|
| App list | The parent's list replaces the QR code's allowlist. Core apps found on the phone (dialer, messages, camera, clock, contacts, Settings, launcher, keyboard) always stay. The maker's own phone and SMS apps stay hidden whatever the list says, so approved contacts cannot be bypassed; they are reported to the server as normal, non-core apps. |
| Approved contacts | Taken from the rules as soon as the first rules arrive. The maintenance screen then shows the list read-only. Emergency numbers always work. |
| Silent bedtime | During a bedtime window the phone makes no sound and shows no notifications, except calls from parents, 112 and help lines ([bedtime.md](bedtime.md)). Per phone, default on |
| School time, bedtime | In a window every non-core app is hidden, except the window's own apps that the app list also allows. Core apps (phone, messages, camera, clock, contacts, Settings, launcher, keyboard) stay, as they always do. Calls and SMS work for approved contacts and emergency numbers, as always. Overlapping windows only allow what all of them allow. |
| DNS | The phone switches private DNS to `<id>.dns.plainphone.org` only when the rules say `dns.ready`. Until then it keeps the QR code's host. Android itself also keeps the old host if the new one does not answer. |
| Location | When the parent has location on: Device Owner grants the location permissions (no dialog), switches location on and blocks switching it off (`DISALLOW_CONFIG_LOCATION`). "Find" and an unanswered "Are you okay?" get one precise fix; in mode `always` a coarse position every `intervalMinutes` while syncs run (see [location.md](location.md)). When location is off, nothing is read or sent, and the restriction is lifted. |

### Schedules and time

Windows are evaluated in wall-clock time of the phone's time zone from the rules. `days` are
the days a window **starts**; a window with `end` before `start` runs past midnight. On the
nights the clocks change, a bedtime from 21:00 to 07:00 still starts at 21:00 and ends at 07:00
(one hour shorter in spring, one hour longer in autumn), and a window that would start in the
skipped spring hour starts when the clocks jump. Automatic date and time are forced by the lock,
so the child cannot move the clock. The phone sets an alarm for the next start or end; alarms
are inexact in deep sleep (exact alarms need a permission the user must grant), so the window
is also re-checked whenever the screen turns on.

## Location provider

The platform's `fused` provider is used when the phone has one. On phones with Google Play
services it is backed by Google's fused location. If fused is unavailable or gives no fix,
the app uses GPS and the network provider via `LocationManager`. The app does not include
the Play services library.

Each lookup has a 30-second budget across providers and can reuse cached fixes that meet the
age and accuracy limits. Saved check-in and saved or cached Find positions upload before new
lookups, which run in order of server expiry. Find and missed check-ins use the retry schedule in [Location time and
accuracy](location.md#location-time-and-accuracy). A position answers Find if it was
recorded at or after the request. If a precise or scheduled coarse lookup gives no fix, the phone
sends its newest known position with the original recorded time. The phone keeps pending safety
positions encrypted on the device and retries temporary upload failures while the request is open.
Only the latest position is stored on the server (D7).

## Status

After a sync the phone sends battery level and charging, app version, whether it is Device
Owner, whether a maintenance unlock is running, which lock steps failed, the ETag of the rules
it applied and when, and the DNS host it actually uses. "Lock intact" means every lock step held
and no maintenance unlock is running. The status goes out at once when anything about the lock
changes, otherwise every 15 minutes. The web dashboard shows when the phone last contacted
the server at the top of its overview. The status section explains failed lock steps and puts
raw step names and app installation overruns under **Show technical details**.

## Not done yet

- The phone does not yet show pending Self-profile changes with a countdown, or let the child
  ask for a new app or contact.
- Nothing here has run on a real phone yet. The chain is tested end to end against the real
  server ([`scripts/e2e-phone-sync.sh`](../scripts/e2e-phone-sync.sh)). A local HTTP stub confirms
  DNS provisioning so the test can check that the phone applies its assigned host. Android calls
  (WorkManager timing in Doze, location on Samsung and Xiaomi, `setLocationEnabled`) need the
  test phone.
