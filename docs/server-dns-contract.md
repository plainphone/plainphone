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

Configured with `DNS_API_URL` (e.g. `http://<private-ip>:8053/`, see `PPDNS_API_BIND` in `dns/.env.example`) and `DNS_API_TOKEN` (bearer).

| When | Call |
|---|---|
| A phone is paired, or any web-filter rule changes | `PATCH /v1/clients/{id}` with `{profile, blocked_categories, block_adult, allow_domains, block_domains}`; on `404`, `POST /v1/clients` with the same body plus `client_id` |
| A phone is removed | `DELETE /v1/clients/{id}` (`404` counts as done) |

Both calls are idempotent. If a call fails, the API request that caused it still succeeds: the
phone is marked `dns_dirty`, the PWA shows "not synced yet", and the server's sweeper retries
every minute. A version counter makes sure an older, slower attempt cannot mark a newer change
as synced.

## Mapping

| Server rule | Sent as |
|---|---|
| Phone profile `child` / `self` | `profile` |
| Blocked categories (`social`, `adult`, `gambling`, `games`, `dating`, `video`) | `blocked_categories`: the full set, sorted. An empty list means every switch is off. The DNS service replaces its set with it |
| Category `adult` blocked | also `block_adult: true`, the same thing for a DNS service from before categories existed. It must agree with `blocked_categories`, otherwise the DNS service answers `400` |
| Allowed / blocked domains | `allow_domains` / `block_domains` (full lists) |

What each category blocks, and what a child keeps whatever the parent switches, is in
[dns/README.md](../dns/README.md#categories). In short: the DNS service turns a category into
AdGuard service groups and block lists per phone; the VPN/proxy/Tor bypass list, SafeSearch and
YouTube Restricted Mode stay on for a `child` phone. A parent may switch every category off for a
child, including `adult`.

The server always sends the full set, so the DNS service's own profile defaults (`self` blocks no
category) only apply to clients created without it. A new phone on the server starts with every
category blocked, also a `self` phone (spec: "all on by default"); the owner opens categories up
through their key, like any other loosening.

Old and new can be deployed in either order. A DNS service from before categories ignores
`blocked_categories` and applies `block_adult` (and then keeps blocking the other categories for a
child, as before). An older server sends only `block_adult`; the new DNS service reads that as
"add or remove `adult`" and leaves the rest of the phone's categories alone.

`POST /v1/clients` accepts the server's `client_id` (409 if it exists, 400 if invalid). The DNS
resolver refuses unregistered ClientIDs, so a phone's private DNS only works once the first sync
has succeeded; until then the PWA shows the filter as "not synced yet". Domain list changes take
about 5 seconds to apply in AdGuard; profile and category changes are immediate.

## Testing

- `server/test/dns-provider.test.ts` runs the HTTP adapter against a stand-in for `/v1/clients`.
- `server/test/rules.test.ts` checks that rule changes reach the provider, and that a failed
  sync is retried by the sweeper.
- End-to-end with real DNS answers lives in `dns/tests`.
