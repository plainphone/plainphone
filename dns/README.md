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

## Profiles and categories

Every phone has a **profile** and a set of **blocked categories**. The profile decides what is
always on; the categories are the parent's switches (the six the Plainphone server stores per
phone).

Blocked for every phone, whatever the profile or categories say: ads, tracking and malware
([HaGeZi Multi PRO](https://github.com/hagezi/dns-blocklists), [OISD big](https://oisd.nl)) and
encrypted DNS endpoints (DoH/DoT/DoQ), so apps cannot go around the filter
([HaGeZi DoH](https://github.com/hagezi/dns-blocklists)).

| | `child` | `self` |
|---|---|---|
| Categories blocked when none are given | all six | none |
| VPN/proxy/Tor bypass ([HaGeZi bypass](https://github.com/hagezi/dns-blocklists)), private relays (AdGuard's `privacy` group) | blocked, cannot be switched off | allowed |
| SafeSearch (Google, Bing, DuckDuckGo, Ecosia, Yandex, Pixabay) | forced, cannot be switched off | forced while `adult` is blocked, otherwise off |
| YouTube Restricted Mode | strict, cannot be switched off | moderate while `adult` is blocked, otherwise off |

The parent is in charge of the categories, also for a child: any of them can be switched off, and
a profile change starts from the new profile's defaults.

### Categories

| `blocked_categories` | Blocks | In AdGuard Home |
|---|---|---|
| `social` | Facebook, Instagram, Snapchat, TikTok, X, Reddit, Discord, Pinterest and the rest of AdGuard's `social_network` group | blocked services |
| `adult` | Porn ([OISD NSFW](https://oisd.nl)) and OnlyFans | client tag `device_other` (the OISD NSFW list) and the service `onlyfans` |
| `gambling` | Betting and casino sites ([HaGeZi gambling](https://github.com/hagezi/dns-blocklists)) and AdGuard's `gambling` group | client tag `os_other` (the HaGeZi gambling list) and the group |
| `games` | Steam, Roblox, Minecraft, Epic Games, PlayStation, Xbox Live and the rest of AdGuard's `gaming` group | blocked services |
| `dating` | Tinder, Grindr and the rest of AdGuard's `dating` group | blocked services |
| `video` | Twitch, Vimeo, Dailymotion, Bigo Live | blocked services |

YouTube is in no category. It is forced into Restricted Mode (strict for a child), because many
schools use it. A parent can block it per phone with `block_domains`. TikTok counts as `social`
(that is where AdGuard files it), OnlyFans as `adult`, Twitch as `video`. A service that one
category names is taken out of the others, so switching `social` off does not open OnlyFans.

How this works inside AdGuard Home: services are the per-client `blocked_services`. AdGuard
applies filter lists to every client, so ppdns downloads the lists that belong to one switch and
adds a client-tag modifier to every rule (`||example.com^$ctag=os_other`). AdGuard only accepts
its own fixed set of tags, so three of them are used as flags, and a phone's tags decide which of
those rules apply:

| Client tag | List it switches on | Set when |
|---|---|---|
| `user_child` | HaGeZi bypass list, YouTube strict Restricted Mode | profile is `child` |
| `device_other` | OISD NSFW | category `adult` is blocked |
| `os_other` | HaGeZi gambling | category `gambling` is blocked |

The rewritten lists live in `/opt/adguardhome/work/userfilters/` and are refreshed every 12
hours. The phone's categories are read back from its tags and services, so AdGuard Home's config
stays the only state.

**Upgrading from the first release.** The gambling list used to be tied to `user_child`. A phone
created back then has the gambling services and `user_child`, so it reads as "all six blocked"
(nothing changes for it). ppdns adds the new `os_other` tag to such phones when it starts and
after every list refresh (the log says `added the new category tags`). Between the lists being
rewritten (the `init` step of `docker compose up`) and ppdns starting, the gambling list does not
apply to those children; their gambling services stay blocked. If a download of the list fails,
the old file is kept and retagged.

Only registered ClientIDs can use the resolver (AdGuard's allowed clients). An
unknown ClientID, or none, gets `REFUSED`, so the server is not an open
resolver. The allowed list always holds a placeholder entry as well, because an
empty list would mean "everyone".

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
  "blocked_categories": ["adult", "dating", "gambling", "games", "social", "video"],
  "block_adult": true,
  "allow_domains": [],
  "block_domains": ["example.org"]
}
```

| Call | Body | Answer |
|---|---|---|
| `POST /v1/clients` | `profile` (`child` or `self`, required), `blocked_categories` (list, default: all six for child, none for self), `block_adult` (bool, see below), `client_id` (optional, see below), `allow_domains`, `block_domains` (optional lists) | `201` + client. `409` if `client_id` exists |
| `GET /v1/clients/{client_id}` | | `200` + client, `404` |
| `PATCH /v1/clients/{client_id}` | any of `profile`, `blocked_categories`, `block_adult`, `allow_domains`, `block_domains`. A list replaces the old list; a missing field (or `null`) is left alone | `200` + client, `404` |
| `DELETE /v1/clients/{client_id}` | | `204`, `404` |
| `GET /v1/clients` | | `200` + `{"clients": [...]}` |
| `GET /v1/profiles` | | `200` + `{"profiles": ["child", "self"]}` |
| `GET /healthz` (no token) | | `200 {"adguard": true}` or `503` |

Errors are `{"error": "..."}` with `400` (bad input), `401` (token),
`404`, `409` or `502` (AdGuard Home refused the change).

Rules for the fields:

- `client_id`: 4 to 63 characters, `a-z`, `0-9` and `-`, starting with a letter
  or digit, not starting with `monitor-` (reserved for the self-test). Leave it out and ppdns makes a random 20-character one. The server
  may choose its own (so it can store it before calling ppdns and retry safely):
  call `PATCH` first and `POST` with the same `client_id` on `404`.
- `blocked_categories`: any of `adult`, `dating`, `gambling`, `games`, `social`, `video`. It
  replaces the whole set, `[]` means none. An unknown name, or anything but a list of strings,
  is a `400`. Answers list them sorted.
- `block_adult`: the older way to switch `adult` alone. On its own it adds or removes `adult`
  and leaves the other categories alone. Together with `blocked_categories` it must agree with
  whether `adult` is in the list, otherwise `400`. Answers still carry it (`true` when `adult` is
  blocked), for callers from before categories. A child may now have it `false`: before categories
  ppdns ignored that.
- Changing `profile` without saying which categories starts from the new profile's defaults
  (child: all six, self: none). Changing something else keeps the categories.
- `allow_domains` / `block_domains`: domain names; they also cover subdomains.
  At most 1,000 each, and a domain cannot be in both. The whole request is
  checked before anything changes, so a `400` means nothing was applied. Allowed domains win over
  every blocklist.
- Changes to `profile` and the categories take effect at once. Changes to
  `allow_domains` / `block_domains` take effect after AdGuard Home has rebuilt
  its filter engine, about 5 seconds with the current lists. Batch them.
- Changing a profile on a `self` phone is not a loosening check: ppdns does
  what it is told. The delay, the trusted person and pay-to-unlock live in the
  Plainphone server.

The same operations exist on the command line inside the `api` container:

```sh
docker compose exec api python -m ppdns create child
docker compose exec api python -m ppdns create self --categories social,gambling
docker compose exec api python -m ppdns list
docker compose exec api python -m ppdns show <client-id>
docker compose exec api python -m ppdns delete <client-id>
docker compose exec api python -m ppdns selftest
docker compose exec api python -m ppdns backup
```

## Background jobs (in the `api` container)

| Job | When | What |
|---|---|---|
| Blocklists | every 12 h | download the lists that belong to a profile or category, add the tags, tell AdGuard to reload, and give phones from an older ppdns the tags they now need |
| New lists | at start | adds lists that a newer ppdns knows to an existing install |
| Certificate | every 5 min | when lego has renewed the certificate, AdGuard re-reads it without a restart |
| Self-test | every 5 min | real DoT queries via a hidden `monitor-…` child ClientID: `example.com` must resolve, `googlesyndication.com` must be blocked, the certificate AdGuard actually serves must have 10+ days left (if it is older than the file lego wrote, ppdns forces a reload), and the last backup (and, with S3, the last upload) must be younger than 36 h. The result goes to `PPDNS_KUMA_PUSH_URL` (Uptime Kuma push monitor) if set |
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

The end-to-end tests create a few dozen phones through the API, one per case, and delete them
again at the end. They check every category switch with real domains over DoT, so run them
against a live server only with a token you may use for that.

By hand with `kdig` (from knot-dnsutils):

```sh
kdig @dns.plainphone.org +tls-ca +tls-hostname=<client-id>.dns.plainphone.org pornhub.com
```

A blocked name answers `0.0.0.0` (or `::` for AAAA). SafeSearch shows up as a
CNAME to `forcesafesearch.google.com` or `restrict.youtube.com`.

## List download cost

On init, ppdns reuses a nonempty tagged list with the current tag if the file is
younger than `PPDNS_LISTS_REFRESH_HOURS` (12 hours by default). Missing, stale,
and legacy-tagged files still take the download path. The scheduled refresh
still fetches upstream, and startup still asks AdGuard to reload its filters.
If a download fails, retagging a legacy copy streams it to an atomic replacement
while retaining the age of the last upstream download.

On a Linux worker with Python 3.13, a synthetic 300,000-rule legacy list peaked
at 46.5 MiB RSS before streaming and 20.9 MiB afterwards. Nine cold-process
runs of `PYTHONPATH=dns python3 -m ppdns --help` had median wall times of 155.8 ms
before deferring command imports and 56.9 ms afterwards. This measures CLI
startup, excluding network and AdGuard initialization.
