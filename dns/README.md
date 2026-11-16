# Plainphone filter DNS

The web filter of a Plainphone is a private DNS-over-TLS (DoT) resolver. Every
phone gets its own hostname, `<ClientID>.dns.plainphone.org`, which the
Plainphone app sets as Android's private DNS and locks. The ClientID decides
which profile the phone gets.

This folder holds the whole service:

| Part | What it does |
|---|---|
| [AdGuard Home](https://github.com/AdguardTeam/AdGuardHome) | The resolver. Serves DoT on port 853, filters, rewrites SafeSearch |
| `ppdns/` | A small Python service (standard library only): the API the Plainphone server calls, the per-profile blocklists, a self-test for monitoring, and backups |
| [lego](https://github.com/go-acme/lego) | Gets and renews the wildcard certificate (`*.dns.plainphone.org`) from Let's Encrypt with a DNS-01 challenge |
| `compose.yaml` | Runs all of it with Docker Compose |

Run your own: [docs/self-hosting-dns.md](../docs/self-hosting-dns.md). What is
stored and for how long: [docs/privacy.md](../docs/privacy.md).

## Profiles

| | `child` | `self` | `self` + `block_adult` |
|---|---|---|---|
| Ads, tracking, malware ([HaGeZi Multi PRO](https://github.com/hagezi/dns-blocklists), [OISD big](https://oisd.nl)) | blocked | blocked | blocked |
| Encrypted DNS endpoints (DoH/DoT/DoQ), so apps cannot go around the filter ([HaGeZi DoH](https://github.com/hagezi/dns-blocklists)) | blocked | blocked | blocked |
| Adult content ([OISD NSFW](https://oisd.nl)) | blocked | allowed | blocked |
| Gambling ([HaGeZi gambling](https://github.com/hagezi/dns-blocklists)), VPN/proxy/Tor bypass ([HaGeZi bypass](https://github.com/hagezi/dns-blocklists)) | blocked | allowed | allowed |
| Social media, games, gambling, dating, private relays (AdGuard's service groups), plus TikTok, Twitch, Vimeo, Dailymotion, Bigo Live | blocked | allowed | allowed |
| SafeSearch (Google, Bing, DuckDuckGo, Ecosia, Yandex, Pixabay) | forced | off | forced |
| YouTube Restricted Mode | strict | off | moderate |

YouTube itself is not blocked for children. It is forced into strict Restricted
Mode, because many schools use it. A parent can block it per phone with
`block_domains`.

How profiles work inside AdGuard Home: AdGuard applies filter lists to every
client, so ppdns downloads the profile-specific lists and adds a client-tag
modifier to every rule (`||example.com^$ctag=user_child`). A phone's tags
decide which of those rules apply: `user_child` for the child profile,
`device_other` for "block adult content". The rewritten lists live in
`/opt/adguardhome/work/userfilters/` and are refreshed every 12 hours.

Only registered ClientIDs can use the resolver (AdGuard's allowed clients). An
unknown ClientID, or none, gets `REFUSED`, so the server is not an open
resolver.

## API

The Plainphone server talks to ppdns over HTTP. The API is private: publish it
only on a private interface (`PPDNS_API_BIND`, for example a Tailscale IP) and
send `Authorization: Bearer $PPDNS_API_TOKEN` with every `/v1` call. Bodies are
JSON.

A phone (a "client") looks like this:

```json
{
  "client_id": "k3v9q2m7x4p8t6w1z5r0",
  "hostname": "k3v9q2m7x4p8t6w1z5r0.dns.plainphone.org",
  "profile": "child",
  "block_adult": true,
  "allow_domains": [],
  "block_domains": ["example.org"]
}
```

| Call | Body | Answer |
|---|---|---|
| `POST /v1/clients` | `profile` (`child` or `self`, required), `block_adult` (bool, default true for child and false for self; always true for child), `client_id` (optional, see below), `allow_domains`, `block_domains` (optional lists) | `201` + client. `409` if `client_id` exists |
| `GET /v1/clients/{client_id}` | | `200` + client, `404` |
| `PATCH /v1/clients/{client_id}` | any of `profile`, `block_adult`, `allow_domains`, `block_domains`. A list replaces the old list; a missing field is left alone | `200` + client, `404` |
| `DELETE /v1/clients/{client_id}` | | `204`, `404` |
| `GET /v1/clients` | | `200` + `{"clients": [...]}` |
| `GET /v1/profiles` | | `200` + `{"profiles": ["child", "self"]}` |
| `GET /healthz` (no token) | | `200 {"adguard": true}` or `503` |

Errors are `{"error": "..."}` with `400` (bad input), `401` (token),
`404`, `409` or `502` (AdGuard Home refused the change).

Rules for the fields:

- `client_id`: 4 to 63 characters, `a-z`, `0-9` and `-`, starting with a letter
  or digit. Leave it out and ppdns makes a random 20-character one. The server
  may choose its own (so it can store it before calling ppdns and retry safely):
  call `PATCH` first and `POST` with the same `client_id` on `404`.
- `allow_domains` / `block_domains`: domain names; they also cover subdomains.
  At most 1,000 each, and a domain cannot be in both. Allowed domains win over
  every blocklist.
- Changes to `profile` and `block_adult` take effect at once. Changes to
  `allow_domains` / `block_domains` take effect after AdGuard Home has rebuilt
  its filter engine, about 5 seconds with the current lists. Batch them.
- Changing a profile on a `self` phone is not a loosening check: ppdns does
  what it is told. The delay, the trusted person and pay-to-unlock live in the
  Plainphone server.

The same operations exist on the command line inside the `api` container:

```sh
docker compose exec api python -m ppdns create child
docker compose exec api python -m ppdns list
docker compose exec api python -m ppdns show <client-id>
docker compose exec api python -m ppdns delete <client-id>
docker compose exec api python -m ppdns selftest
docker compose exec api python -m ppdns backup
```

## Background jobs (in the `api` container)

| Job | When | What |
|---|---|---|
| Blocklists | every 12 h | download the profile lists, add the tags, tell AdGuard to reload |
| New lists | at start | adds lists that a newer ppdns knows to an existing install |
| Certificate | every 5 min | when lego has renewed the certificate, AdGuard re-reads it without a restart |
| Self-test | every 5 min | real DoT queries via a hidden `monitor-…` child ClientID: `example.com` must resolve, `googlesyndication.com` must be blocked, the certificate must have 10+ days left and a backup must be younger than 36 h. The result goes to `PPDNS_KUMA_PUSH_URL` (Uptime Kuma push monitor) if set |
| Backup | at start and every 24 h | `AdGuardHome.yaml` (all ClientIDs and rules) as `.tar.gz` in the data volume, last 14, and to S3 if `PPDNS_BACKUP_S3_*` is set |

## Tests

```sh
# unit tests, no network
python3 -m unittest discover -s dns/tests -p 'test_ppdns.py' -v

# the whole stack in Docker with a self-signed certificate, tested over DoT
dns/tests/run-stack.sh

# against a live server (verifies the real certificate)
PPDNS_TEST_SERVER=dns.plainphone.org PPDNS_TEST_DOMAIN=dns.plainphone.org \
PPDNS_TEST_API=http://<private-ip>:8053 PPDNS_API_TOKEN=... PPDNS_TEST_VERIFY=1 \
python3 -m unittest discover -s dns/tests -p 'test_e2e.py' -v
```

By hand with `kdig` (from knot-dnsutils):

```sh
kdig @dns.plainphone.org +tls-ca +tls-hostname=<client-id>.dns.plainphone.org pornhub.com
```

A blocked name answers `0.0.0.0` (or `::` for AAAA). SafeSearch shows up as a
CNAME to `forcesafesearch.google.com` or `restrict.youtube.com`.
