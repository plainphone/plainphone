# Server ↔ DNS service

The server (`server/`) keeps each phone's web-filter rules in PostgreSQL and pushes them to the
filtering DNS service (`dns/`, AdGuard Home behind a small API). The phone itself only gets a
hostname: `<clientId>.dns.plainphone.org`, which it forces as private DNS.

## Who owns what

- **The server owns the ClientID.** It generates 20 characters from `[a-z2-7]` when a phone is
  paired and stores it before calling the DNS service, so a failed call can always be retried
  with the same ID.
- **The DNS service owns filtering:** block lists, SafeSearch, the encrypted-DNS bypass list, and
  what the `child` and `self` profiles mean (see `dns/ppdns/profiles.py`).

## Calls (DNS_PROVIDER=http)

Configured with `DNS_API_URL` (e.g. `http://ppdns:8000/`) and `DNS_API_TOKEN` (bearer).

| When | Call |
|---|---|
| A phone is paired, or any web-filter rule changes | `PATCH /v1/clients/{id}` with `{profile, block_adult, allow_domains, block_domains}`; on `404`, `POST /v1/clients` with the same body plus `client_id` |
| A phone is removed | `DELETE /v1/clients/{id}` (`404` counts as done) |

Both calls are idempotent. If a call fails, the API request that caused it still succeeds: the
phone is marked `dns_dirty`, the PWA shows "not synced yet", and the server's sweeper retries
every minute. A version counter makes sure an older, slower attempt cannot mark a newer change
as synced.

## Mapping and known gaps

| Server rule | Sent as |
|---|---|
| Phone profile `child` / `self` | `profile` |
| Category `adult` blocked | `block_adult: true` |
| Allowed / blocked domains | `allow_domains` / `block_domains` (full lists) |
| Categories `social`, `gambling`, `games`, `dating`, `video` | **Not sent yet.** The DNS service's `child` profile always blocks these groups and `self` never does; there are no per-client switches. The PWA lets a parent switch them, and the server stores the choice, but it only takes effect once the DNS service supports per-client categories. |

`POST /v1/clients` accepts the server's `client_id` (409 if it exists, 400 if invalid). The DNS
resolver refuses unregistered ClientIDs, so a phone's private DNS only works once the first sync
has succeeded; until then the PWA shows the filter as "not synced yet". Domain list changes take
about 5 seconds to apply in AdGuard; profile and `block_adult` changes are immediate.

## Testing

- `server/test/dns-provider.test.ts` runs the HTTP adapter against a stand-in for `/v1/clients`.
- `server/test/rules.test.ts` checks that rule changes reach the provider, and that a failed
  sync is retried by the sweeper.
- End-to-end with real DNS answers lives in `dns/tests`.
