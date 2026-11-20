# Live updates

While the dashboard or the parent app is open, it keeps one connection to the server and hears
about news at once: an SOS, a request and its answer, a new position, a reply to "Are you okay?",
a message in the family inbox, a change in the phone's status. Nothing needs a reload. When the
dashboard tab is hidden or the app goes to the background, the connection closes; push
notifications cover that time, as before.

Live updates are a convenience on top of the normal API and push, never instead of them. Every
view still loads through the API and still polls when there is no live connection.

## For parents

- **On by default, per device.** Settings → "Live updates" in the dashboard, and
  Settings → "Live updates" in the parent app. Switched off, the device makes no connection and
  the views check for news every so often, as they did before.
- **SOS at once.** An SOS shows as a banner on every page of the dashboard and every screen of the
  app. The dashboard plays a short alarm tone (setting "Sound for SOS", on by default; a browser
  may block sound until you have clicked on the page once). The app vibrates (setting "SOS alert",
  on by default); the push notification for the same SOS still arrives and brings the sound.
- **The "Live" mark** next to the menu (dashboard) or under "Phones" (app) says whether the
  connection is up: "Live", "Connecting", or "Not live" when the server or the network does not
  allow it. "Not live" is not an error: the views check for news on a timer, as they did before.

These switches are per device and per parent, not per phone: they change how quickly a parent's
screen updates, nothing on the child's phone, so there is nothing for the phone's rules to carry.

## How it works

```
phone ──► API route ──► database ──► publish(event) ──► event bus ──► live hub ──► open dashboards
                                     (after commit)     (Postgres        (one per       (EventSource /
                                                         LISTEN/NOTIFY)   process)        XHR stream)
```

- `GET /api/events` is a [server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)
  stream for a signed-in parent (session cookie or `Authorization: Bearer`). Device tokens are
  refused. The contract is in [server/openapi.yaml](../server/openapi.yaml), operation `getEvents`.
- **Events carry ids only**: `{"type","phoneId","id"?,"kind"?}`. No names, texts, positions or
  household ids. The client refetches through the normal API, with its normal access checks, so a
  live event can never show more than the API would.
- **Only the parent's own households.** A connection is filtered by the households the parent is a
  member of. Membership and the session are checked again every minute: a parent who signs out,
  or is removed from the household, stops getting events (`bye` ends a signed-out stream).
  Trusted persons of a Self phone are not household members and get no live events; push still
  reaches them.

### Event names

| Event | When | Published from |
|---|---|---|
| `sos.created` | A child's phone sent an SOS (also one reported after an SMS) | `POST /device/sos` |
| `sos.updated` | Seen by a parent, delivered later by SMS, sent by push, or given up | SOS route, `deliverSos` |
| `request.created` | A request for an app, a contact or more time (`kind`) | `createRequest`, `createMoreTimeRequest` |
| `request.answered` | Answered by a parent, by a parent on the phone, or expired on answering | requests and more-time services |
| `location.updated` | A new latest position was stored | `PUT /device/location`, check-in sweeper |
| `safety.updated` | A ring or "Are you okay?" was shown, answered or went unanswered | `POST /device/safety/:rid`, `notifySafety` |
| `inbox.message` | A child message, a parent reply, a delivery count or a device receipt | quick messages, family inbox |
| `phone.status` | A visible status change, the first sync after pairing, back online, gone quiet | `PUT /device/status`, `GET /device/rules`, offline sweeper |

Events are published from the same places that send push today, after the change is committed and
before the push goes out, so open dashboards are usually first. A muted phone or "can wait" news
batched into the weekly summary still updates open dashboards: muting is about notifications, not
about what a parent sees when looking.

`phone.status` is not sent for every status report. Phones report often; only a change in what the
dashboard shows counts (lock, rules receipt, filter, app version and update, battery in steps of
ten). Minutes used are left out ([server/src/services/live-status.ts](../server/src/services/live-status.ts)).

Control events: `ready` (`{"resumed":bool}`) when connected, `refetch` when the client may have
missed something, `ping` every 25 seconds, and `bye` when the session ended.

### Resume, restarts and reconnecting

Each event has an id `<boot>.<n>`. The server keeps the last 1000 events (at most 10 minutes) in
memory. A client that reconnects sends the last id it saw (`Last-Event-ID`, or `?lastEventId=` for
a client that cannot set headers) and gets what it missed, filtered to its households, then
`ready` with `resumed: true`. If the id is from before a server restart (another boot) or older
than the buffer, the server sends `refetch` and the client reloads its views. Nothing is stored in
the database, so there is no migration.

Clients reconnect with backoff (1, 2, 4, 8, 15, 30, 60 seconds, ±20 % so a restart does not bring
every client back in the same second) and treat 60 seconds without a byte (the server pings every
25) as a dead connection. A refusal (`429` too many connections for one account, `503` too many on
the server, or a server without this endpoint) makes the client poll and try again after five
minutes.

Limits per server process: 10 open streams per parent (one per tab, the app, another device) and
5000 in total. A client that stops reading is dropped once 256 KB is queued for it.

### Why Postgres LISTEN/NOTIFY

The event bus has two implementations behind one interface (`EventBus` in
[server/src/services/live-events.ts](../server/src/services/live-events.ts)):

- `LocalEventBus`: in the process. Used in tests.
- `PostgresEventBus`: `NOTIFY plainphone_live` on publish, and every server process `LISTEN`s and
  passes the event to its own hub, the publishing process included.

The server uses Postgres. Plainphone always runs with exactly one database, so LISTEN/NOTIFY costs
one extra connection and no new service. It makes live updates work when more than one server
process shares the database: during a rolling deploy the old and the new container both run for a
moment, and a phone's report may land on one while a dashboard is connected to the other. NOTIFY is
delivered only after the publishing transaction commits, so a client's refetch always sees the
change. Payloads are a few hundred bytes, far below Postgres' 8000-byte limit, and are validated on
receipt. If the listening connection cannot be set up, the server logs it and keeps events in the
process.

## Reverse proxy settings

The stream is a long-lived HTTP response. The server sends `Content-Type: text/event-stream`,
`Cache-Control: no-cache, no-store, no-transform` and `X-Accel-Buffering: no`, and a ping every 25
seconds, so most proxies work unchanged. Check:

- **Do not buffer or compress** `text/event-stream`. Traefik's `compress` middleware already skips
  it; nginx honours `X-Accel-Buffering: no` (or set `proxy_buffering off;` for `/api/events`);
  Caddy streams by default.
- **Idle timeouts above 25 seconds** between bytes. Traefik's defaults are fine; nginx's
  `proxy_read_timeout` default (60 s) is fine; Cloudflare's 100 s is fine.
- **HTTP/1.1 or HTTP/2 to the browser.** Over HTTP/1.1 a browser allows only six connections per
  host, and each open dashboard tab uses one. HTTP/2 (the default behind Traefik, Caddy and most
  CDNs) has no such limit.

nginx example:

```nginx
location /api/events {
    proxy_pass http://plainphone:8080;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

On shutdown the server closes every stream so it can stop at once; clients reconnect to the new
process and refetch.

## Privacy

Live events contain no personal data: event name, phone id and the id of the SOS, request or
message. They are not logged or stored. The content a parent sees still comes from the API, with
the same access checks as without live updates. See [privacy.md](privacy.md).

## Evidence

Faster awareness of an SOS or an unanswered check-in is the point of these features
([sos.md](sos.md), [location.md](location.md)): the value of an alarm falls with the time it takes to
reach the person who can act. Live updates do not add any new data about the child; they only shorten
the time between something happening and the parent's open screen showing it.
