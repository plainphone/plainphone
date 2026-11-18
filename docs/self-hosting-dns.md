# Run your own Plainphone filter DNS

This guide sets up the same DNS filter that runs on `dns.plainphone.org`, on
your own server and domain. You end up with a DNS-over-TLS resolver where every
phone has its own hostname, `<ClientID>.dns.example.org`, and its own profile.
How the parts fit together is in [dns/README.md](../dns/README.md).

## What you need

- A Linux server with Docker and the Compose plugin (v2.24 or newer). 1 GB of
  RAM is enough for the resolver (it uses about 300 MB with all lists); 2 GB
  gives room for list updates. Any EU or home server works.
- A domain whose DNS is at Cloudflare. The certificate is a wildcard
  (`*.dns.example.org`), and wildcards need a DNS-01 challenge. lego, which gets
  the certificate, [supports many other DNS providers](https://go-acme.github.io/lego/dns/); change
  `--dns cloudflare` and the token variable in `compose.yaml` if yours is not
  Cloudflare.
- Port 853/TCP open to the internet. Nothing else needs to be public.

## 1. DNS records

Make two records that point at your server, without a proxy (in Cloudflare:
"DNS only", grey cloud). DoT is not HTTP and cannot go through Cloudflare's
proxy.

| Type | Name | Value |
|---|---|---|
| A | `dns.example.org` | your server's IPv4 |
| A | `*.dns.example.org` | your server's IPv4 |
| AAAA | both of the above | your server's IPv6, if it has one |

## 2. A Cloudflare token for the certificate

In Cloudflare: My Profile (or Manage Account) > API Tokens > Create Token >
"Edit zone DNS", limited to your zone. lego uses it only to write the
`_acme-challenge` TXT record.

## 3. Settings

```sh
git clone https://github.com/plainphone/plainphone
cd plainphone/dns
cp .env.example .env
chmod 600 .env
```

Fill in `.env`:

| Setting | Value |
|---|---|
| `PPDNS_DOMAIN` | `dns.example.org` |
| `CLOUDFLARE_DNS_API_TOKEN` | the token from step 2 |
| `PPDNS_ADGUARD_PASSWORD` | a long random password for the AdGuard admin |
| `PPDNS_ADGUARD_PASSWORD_HASH` | its bcrypt hash, in single quotes: `htpasswd -nbBC 10 "" 'the-password' \| cut -d: -f2` (or `docker run --rm httpd:2.4-alpine htpasswd -nbBC 10 "" 'the-password'`) |
| `PPDNS_API_TOKEN` | `openssl rand -hex 32` |
| `PPDNS_ADMIN_BIND`, `PPDNS_API_BIND` | where the admin UI (port 3000) and the API (8053) listen. Keep `127.0.0.1`, or use a private address such as your Tailscale IP. **Never** `0.0.0.0` |
| `LEGO_SERVER` | use the Let's Encrypt staging URL the first time if you want to test without hitting rate limits; then switch back and delete the `certs` volume |

Optional: `PPDNS_KUMA_PUSH_URL` for monitoring (step 6) and
`PPDNS_BACKUP_S3_*` for off-site backups (step 7).

## 4. Start it

```sh
docker compose up -d --build
docker compose logs -f certs      # wait for "Server responded with a certificate"
docker compose ps                 # all running, init exited (0)
```

On first start, `init` writes `AdGuardHome.yaml` with the privacy settings from
[privacy.md](privacy.md) and downloads the blocklists. After that AdGuard Home
owns the file; change settings in its admin UI or through the API. The
certificate is renewed by itself, and AdGuard picks up the new one without a
restart.

Open the firewall for 853/TCP only. Port 53 is never published, so the server
cannot be abused as an open resolver.

## 5. Add a phone and test it

```sh
docker compose exec api python -m ppdns create child
```

This prints the phone's hostname, for example
`k3v9q2m7x4p8t6w1z5r0.dns.example.org`. Test it from any machine:

```sh
kdig @dns.example.org +tls-ca +tls-hostname=k3v9q2m7x4p8t6w1z5r0.dns.example.org pornhub.com    # 0.0.0.0
kdig @dns.example.org +tls-ca +tls-hostname=k3v9q2m7x4p8t6w1z5r0.dns.example.org example.com    # a real address
kdig @dns.example.org +tls-ca +tls-hostname=k3v9q2m7x4p8t6w1z5r0.dns.example.org www.google.com # forcesafesearch.google.com
```

Or run the end-to-end tests (see [dns/README.md](../dns/README.md#tests)).

On the phone, the hostname goes into private DNS. With Plainphone in strong
mode, the QR script sets it (`scripts/provisioning-qr.py --dns-host`). On any
other Android phone you can try it by hand: Settings > Network > Private DNS >
"Private DNS provider hostname".

## 6. Monitoring

ppdns tests itself every 5 minutes over real DNS-over-TLS (allowed name
resolves, ad domain blocked, certificate has 10+ days left, a backup is less
than 36 hours old). Create a **Push** monitor in [Uptime Kuma](https://github.com/louislam/uptime-kuma)
with a 10-minute heartbeat and put its URL in `PPDNS_KUMA_PUSH_URL`. Add a TCP
monitor on port 853 of `dns.example.org` from outside, so a closed firewall is
noticed too. Without Kuma, `docker compose exec api python -m ppdns selftest`
gives the same check (exit code 1 on failure).

## 7. Backups

`AdGuardHome.yaml` holds every phone and rule. ppdns backs it up at start and
every 24 hours into the `data` volume (`/data/backups`, the last 14). Set
`PPDNS_BACKUP_S3_ENDPOINT`, `_REGION`, `_BUCKET`, `_ACCESS_KEY` and
`_SECRET_KEY` to also upload each backup to S3-compatible storage (Hetzner,
Backblaze B2, MinIO, AWS); old copies are deleted there too.

Restore (from the `dns/` folder, with the backup file in the same folder):

```sh
docker compose stop adguard
docker run --rm -v plainphone-dns_conf:/conf -v "$PWD":/backup alpine:3.24 \
  tar xzf /backup/adguard-conf-YYYYMMDDTHHMMSSZ.tar.gz -C /conf
docker compose start adguard
```

(`plainphone-dns` is the compose project name; `docker volume ls` shows the real volume name.) The
blocklists and the certificate are rebuilt by themselves.

## 8. Updates

```sh
git pull
docker compose up -d --build
```

A newer ppdns adds new lists to an existing install at start, and gives phones
that an older version created the tags they now need (see "Upgrading from the
first release" in [dns/README.md](../dns/README.md)). AdGuard Home
itself is pinned in `compose.yaml`; raise the version there after reading its
release notes.

## Using your own filter with the Plainphone app

Build the app and the QR code with your own DNS host (the hostname pattern is
`<ClientID>.<PPDNS_DOMAIN>`), and point your own Plainphone server at your ppdns
API (`PPDNS_API_TOKEN` and the private address from `PPDNS_API_BIND`).

## Use a phone's filter on a router or VPN

In the web dashboard, open the phone's **Web filter**. The address appears for
household members after the DNS service confirms provisioning with
`DNS_PROVIDER=http`. After switching from `mock` to `http`, changing
`DNS_API_URL` or `DNS_HOST_SUFFIX`, or upgrading from an older confirmation
format, the background sync provisions existing phones with the configured
resolver before the dashboard shows their addresses.

Migration `0015_dns_confirmation_provider` keeps the existing confirmation
timestamps. Previously confirmed phones keep using their filter during retries,
including when the resolver's administration API is temporarily unavailable.
A phone with a confirmation from the mock provider waits for a successful HTTP
sync when the server switches to HTTP DNS.

Treat the hostname as private: sharing it gives other devices and apps access
to the same filter rules.

Android Private DNS takes the hostname alone. A compatible router or VPN takes
the hostname and TCP port 853 in its DNS-over-TLS upstream settings, using the
same hostname for TLS verification and SNI. Use `tls://<hostname>:853` only in
clients that support that syntax. A plain DNS IP field cannot select the phone's
profile, and the public resolver currently offers DoT.

For Tailscale, use Android Private DNS and disable **Use Tailscale DNS settings**
on that phone if you can give up MagicDNS names on it. If you need MagicDNS, an
admin can configure a private tailnet DNS forwarder with the phone's DoT upstream.
Tailscale's custom nameserver field takes the forwarder's IP. On the phone,
turn on **Use Tailscale DNS settings** and set Android Private DNS to
**Automatic** so Tailscale can handle DNS. A global DNS
override can apply the same phone's rules to all tailnet devices that accept and
use those settings. For a company VPN, ask IT about an approved forwarder for
public DNS queries that keeps internal domains on company DNS. The Tailscale and
company VPN setups have yet to be verified on a phone. See the
[VPN coexistence research](research/vpn-coexistence.md#resolver-addresses-and-integrations).
