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
