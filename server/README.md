# Plainphone server

TypeScript (Node 24), [Hono](https://hono.dev), PostgreSQL 18 with [Drizzle](https://orm.drizzle.team).
It serves the API for phones and parent apps, and the parent PWA from `web/dist`.

- API contract: [`openapi.yaml`](openapi.yaml). A test fails if it and the routes drift apart.
- Phone sync and a Kotlin client sketch: [`../docs/sync-api.md`](../docs/sync-api.md)
- DNS service integration: [`../docs/server-dns-contract.md`](../docs/server-dns-contract.md)
- Running your own: [`../docs/self-hosting.md`](../docs/self-hosting.md)

## Layout

| Path | What |
|---|---|
| `src/db/schema.ts` | Tables. `drizzle/` holds the generated migrations |
| `src/routes/device.ts` | Phone API: pairing, rules with ETag, app list, location, push token |
| `src/routes/parent.ts` | Parent API: sign-in, households, phones, rules, Self key, approvals |
| `src/services/changes.ts` | Every rule change: applied at once, or held by the Self key |
| `src/services/phones.ts` | Rules document, starter packs, new phones |
| `src/providers/` | Mail (none, log, SMTP), DNS (mock, HTTP), push (none for now) |
| `src/services/sweeper.ts` | Every minute: due delayed changes, DNS retries, expired rows |
| `test/` | Integration tests against a real PostgreSQL |

## Design notes

- **Self key (D12).** Every change is an `Op`. On a Self phone, an op that loosens the rules is
  stored as a pending change: with the delay key it applies at `effectiveAt` (by the sweeper,
  or earlier when the phone polls), with the trusted-person key when that person approves.
  Tightening always applies at once. Schedule edits loosen if they free any minute of the old
  window or allow more apps. Changes to the key itself go through the key, except a longer delay.
- **Pay to unlock (D13)** is a table (`unlock_payments`), a flag (`PAYMENTS_ENABLED`) and an
  endpoint that answers 409/501. No payment provider is wired up.
- **Location (D7).** One row per phone; an older fix never overwrites a newer one; switching
  location off deletes it.
- **Secrets at rest.** Magic links, sessions, invites, pairing codes and device tokens are stored
  as SHA-256 hashes. The one exception is a device token waiting for its phone's next poll
  (at most a few seconds normally); the sweeper deletes pairings after a day.
- **Mail** never goes out without a configured provider, and sign-in links put the token in the
  URL fragment, so it is not sent to the server by link scanners and not logged.

## Measure the server footprint

Run `scripts/bench-server.sh [requests] [concurrency]` from the checkout. It
starts a disposable embedded PostgreSQL, seeds one paired phone with 300
apps, and sends HTTP conditional requests over loopback. It reports
throughput, Node CPU per request, and warm and peak sampled Node RSS. RSS
excludes PostgreSQL and the package runner. Use the same worker, Node version
and arguments when comparing revisions.

On a shared Linux worker with Node 24.22.3, one paired run against main
commit `44cdda0` used 2,500 polls and eight concurrent clients:

| Metric | Before | After |
| --- | ---: | ---: |
| HTTP responses per second | 134 | 198 |
| Node CPU per request | 6.215 ms | 4.993 ms |
| Warm Node RSS | 278.3 MiB | 271.2 MiB |
| Peak sampled Node RSS | 360.9 MiB | 306.2 MiB |

RSS varied across runs. In three earlier runs of 4,000 polls per version,
median peak Node RSS was 311.8 MiB before and 310.1 MiB after.

The device rules handler still authenticates, applies due changes and
updates last-seen state as needed. It reads the current rules inputs and
evaluates the time-dependent fields on each poll. For small rules, a matching
ETag and identical inputs let it return 304 without building, serializing or
hashing the rules document. The process retains at most eight snapshots,
each with a 32,768-character serialized input limit. On a miss it hashes the same JSON
representation sent to the device.

The parent phone list gets location presence and open-request counts in the
same SQL statement as the phones. The sweeper still runs once per minute
with an unreferenced timer and skips overlapping runs. Pushes are
event-driven. The PostgreSQL plan test seeds 20,000 rows per table and
checks the index for each selective lookup (expired magic links, expired
sessions, and effective delay-key changes). The startup migration adds
those three indexes. Cleanup queries use the affected-row count instead
of returning every deleted ID to Node.

The Docker build precompresses PWA JavaScript and CSS with Brotli and gzip.
Hashed assets are immutable for a year. Entry points, service workers, and
SPA fallbacks require revalidation. Range requests use the identity file.
