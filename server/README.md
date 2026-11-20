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

## Tests and the database

`pnpm test` runs against a real PostgreSQL (`DATABASE_URL`, or an embedded one when it is unset).

- `test/global-setup.ts` runs all migrations **once per run** into a template database.
- `useHarness()` (`test/harness.ts`) copies that template for each test file with
  `CREATE DATABASE ... TEMPLATE` and drops the copy afterwards. Use it for every normal test.
- A test of one migration's backfill needs a database that stops before that migration. Use
  `createLegacyDatabase(upToIdx)` from `test/db.ts`, insert the old-shape rows, call
  `runMigrations`, and assert. Replaying migrations is slow on a busy machine, so pass
  `MIGRATION_TEST_TIMEOUT` (60 s) as the test timeout instead of the default 20 s.
- Never create a database by hand in a test. The helpers drop theirs, also when the test fails.

## Design notes

- **Optional config degrades, it does not crash.** Required settings (database, `DNS_PROVIDER=http`
  without its URL and token) fail fast in `loadConfig`. FCM, APNs, Web Push and SMTP are built in
  `src/services/providers.ts`: an invalid value switches that integration off, logs one line with
  the name and reason (never the value or the underlying error), and appears in `/api/health` as
  `push.errors` and `errors`. A new optional integration must follow the same rule.

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
starts a disposable embedded PostgreSQL, seeds one paired phone with 100 apps,
and sends conditional HTTP requests over loopback. It reports throughput,
Node CPU per request, and warm and peak sampled Node RSS. RSS excludes
PostgreSQL and the package runner. Use the same worker, Node version and
arguments when comparing revisions.

One run per revision on a shared Linux worker with Node 24.22.1 used 4,000
polls and eight concurrent clients. The baseline was main commit `3b3dfb4`.

| Metric | Main | This branch |
| --- | ---: | ---: |
| HTTP 304 responses per second | 675 | 786 |
| Node CPU per request | 1.666 ms | 1.466 ms |
| Warm Node RSS | 280.3 MiB | 278.0 MiB |
| Peak sampled Node RSS | 337.1 MiB | 337.3 MiB |

The benchmark measures steady-state polling for one phone. It does not
measure a deployment with many distinct phones.

The device rules handler still authenticates, applies due changes and
updates last-seen state as needed. Each poll reads the current rules inputs
with narrow selects, evaluates time-dependent fields, and hashes the JSON
representation. A matching ETag returns 304. A release request changes the
representation and invalidates the previous ETag.

The parent phone list gets location presence and open-request counts in the
same SQL statement as the phones. The sweeper still runs once per minute
with an unreferenced timer and skips overlapping runs. Pushes are
event-driven. The PostgreSQL plan test seeds 20,000 rows per table and
checks the index for each selective lookup (expired magic links, expired
sessions, and effective delay-key changes). The startup migration adds
those three indexes. Cleanup queries use the affected-row count instead
of returning every deleted ID to Node.

The Docker build precompresses PWA JavaScript and CSS with Brotli and gzip.
Hashed assets are immutable for a year. The PWA root, `index.html` and `sw.js`
use `no-cache` and ETags for conditional GETs. SPA fallbacks also require
revalidation. Range requests use the identity file.
