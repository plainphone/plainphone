# Self-hosting the server and parent app

Plainphone's server and the parent web app (PWA) ship as one Docker image. PostgreSQL 18 holds
the data. The filtering DNS service is separate; see [self-hosting-dns.md](self-hosting-dns.md)
to configure it, or run without it (`DNS_PROVIDER=mock`).

> Plainphone is a test version. Try setup and protection on spare hardware before relying on it.

## Quick start

```sh
git clone https://github.com/plainphone/plainphone
cd plainphone
cp .env.example .env     # set POSTGRES_PASSWORD and PUBLIC_URL at least
docker compose up -d
curl http://localhost:8080/api/health
```

Put a TLS-terminating reverse proxy (Caddy, Traefik, nginx) in front and point your domain at
it. Then set `TRUST_PROXY=true` and stop publishing port 8080 to the internet, so rate limits
see each client's own address. The API reads request bodies up to 1 MB; only contact suggestions
and server moves accept more. `PUBLIC_URL` must be the address parents open, because it goes into sign-in mails and the
pairing QR code.

Live updates (`GET /api/events`, [live-updates.md](live-updates.md#reverse-proxy-settings)) are a
long-lived server-sent events stream. The proxy must not buffer or compress `text/event-stream`
and must allow 25 seconds between bytes. Traefik and Caddy work as they are. With nginx, set
`proxy_buffering off;` and `proxy_read_timeout 1h;` for `/api/events`. Serve HTTP/2 to browsers if
you can: over HTTP/1.1 each open dashboard tab takes one of the browser's six connections to the
host. If the stream cannot get through, the dashboard and the app fall back to checking for news
on a timer.

## Connect the apps

In the native parent app, select **Use your own server** at sign-in or in Settings.
Enter the same HTTPS origin you set as `PUBLIC_URL`. The server must return
`ok: true` and `compatibility: 1` from `/api/health`. Sign in again after changing servers.
If your server cannot send sign-in mail, you can still select **Use plainphone.org**
from the same sign-in screen.

For a new Light setup without a dashboard QR, choose **Use your own server** on
the pairing step before generating the pairing code. When you use a setup link or
QR from your dashboard, the address is already included. Strong uses the address
from its provisioning QR. On Android, the address is shown under Maintenance
after the parent PIN is entered.

## Move to your own server

A household owner can copy one phone or a whole household's phone list and rules, then
switch the paired phones without resetting them. Both servers need the move feature and a
valid HTTPS address. Update the phone app before starting. The destination needs a working
[filter DNS service](self-hosting-dns.md) with `DNS_PROVIDER=http`. If a Strong phone has
factory reset protection, connect the same Google accounts on the new server first. If a
Myself phone uses a trusted helper, ask the helper to sign in on the new server in a separate
household before importing.

1. On the current server, open **Household → Move to another server**. Enable **Allow moving
   this phone to another server** on the overview of each phone you want to switch. It is on
   by default for Child phones. A Myself phone needs its key when enabling moving and again
   when starting the move.
2. Open **Household → Move to another server** on the new server in another tab. Copy the old
   server's code from the first tab into the second, then create an invitation.
3. Paste the invitation into the old server's tab. Select one phone or the entire household
   and download the encrypted file. Keep both tabs open.
4. In the new server's tab, select the file and import it. The invitation and file expire
   after seven days. Each invitation accepts one import. Make a fresh invitation if the
   export expires or the rules change before the phone switches.
5. Back on the old server, start the move for each phone you want to switch. Keep the old
   server and DNS service running until the phone checks in on the new server and shows the
   new server address in Android's **Maintenance** screen. You can then remove the old copy.

The phone keeps its Device Owner or Light setup, maintenance PIN, and lock. If the new
server or filter is unavailable, the phone keeps its current protection and retries while
its old server still offers the move. It verifies the new rules and tests the new DNS host
before committing the new connection. Turn off **Allow moving this phone to another server**
on the old server to stop offering a pending move.

- **Filter method.** A Light phone's choice between the VPN filter and Private DNS travels with
  the move and is part of the checked rules, so a Private DNS phone moves like any other.
- **Emergency fallback.** After a move the phone's fallback DNS host is the new server's
  provisioning host (`PROVISIONING_DNS_HOST`, which defaults to a public family DNS host and is sent
  as `fallbackDnsHost` in the rules). Older servers send none, and then the phone keeps its original one. It is never the phone's own per-phone host, which stops
  answering if the phone is removed on the new server. Set `PROVISIONING_DNS_HOST` on the new server.
- **Abandoned moves.** If a phone redeems its move but never finishes (the old server changed the
  rules or stopped offering the move meanwhile), the imported copy is freed once the invitation
  expires: the background sweep clears its pending state and a normal setup QR code works again.
  A phone that has redeemed gets a further full window (7 days) to make its first sync with the new
  server, so one that loses the network right after redeeming is not locked out.
- **Last-moment switch-off.** The phone checks that the old server still offers the move just before
  it commits. A switch-off in the few milliseconds after that check cannot stop the move, but
  the phone only moves into protection rules verified identical to the old ones, so it is no less protected.
- **Import limits.** An imported file is validated with the same rules as the dashboard (name length,
  phone numbers, package names, domains, key delay and pay-to-unlock values). The signature only
  proves which server sent it, not that its values are sensible.

The file contains phone profiles, contacts, app rules, schedules, time limits, DNS preferences,
and phone settings. It excludes login credentials, locations, status and activity history.
Household members sign in and can be invited separately on the new server. The old server
signs the export with Ed25519. Only the invitation's new server can decrypt it using JWE
(ECDH-ES and AES-256-GCM), and that server verifies the signature against the old server's code.

To relocate a self-hosted instance while keeping its existing URL, use a full
[database backup](#backups) and follow the [DNS backup and restore guide](self-hosting-dns.md).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | (set by compose) | PostgreSQL connection string |
| `PUBLIC_URL` | | Public address of the parent app |
| `MAIL_PROVIDER` | `none` | `none` sends nothing (nobody can sign in until you configure mail), `smtp` uses `SMTP_URL`. `log` prints mails to stdout and is refused in production |
| `SMTP_URL` | | e.g. `smtps://user:pass@smtp.example.org:465`. Missing or invalid: mail is switched off and `/api/health` says so |
| `MAIL_FROM` | `Plainphone <no-reply@plainphone.org>` | Sender |
| `DNS_PROVIDER` | `mock` | `http` talks to the DNS service (`DNS_API_URL`, `DNS_API_TOKEN`). `deploy/dokploy-compose.yaml` has no default and refuses to start without it, so a missing value cannot switch a running service back to `mock` |
| `DNS_HOST_SUFFIX` | `dns.plainphone.org` | Phones use `<clientId>.<suffix>` as private DNS |
| `APK_DOWNLOAD_URL` | | Where `/download/android` (the APK address in setup QR codes) redirects. Unset: the newest APK released in `APK_RELEASES_REPO` on GitHub |
| `APK_METADATA_URL` | | HTTPS URL for the metadata JSON matching `APK_DOWNLOAD_URL`. Optional, but enables a version check before download and update notifications in light mode. |
| `APK_RELEASES_REPO` | `plainphone/plainphone` | GitHub repository whose releases `/download/android` follows |
| `APK_SIGNATURE_CHECKSUM` | the project's production key (v0.1.10 and later) | base64url SHA-256 of the app's signing certificate, put in setup QR codes. Set it when you build and sign the app yourself |
| `PROVISIONING_DNS_HOST` | `family.adguard-dns.com` | Private DNS a phone uses from setup until its own filter host is ready |
| `TRUST_PROXY` | `false` | Use `X-Forwarded-For` for rate limits. Set `true` only behind a reverse proxy, with port 8080 not reachable directly |
| `MIGRATE_ON_START` | `true` | Apply database migrations when the server starts |
| `BILLING_ENABLED` | `false` | Paid plan and paid early unlock of the hosted service. Leave it off when self-hosting: every household then has everything, and no payment provider is called. The other `BILLING_*`, `STRIPE_*` and `PLAY_*` variables only matter with it on ([billing.md](billing.md)) |
| `E2EE_PROTOTYPE_ENABLED` | `false` | The E2EE phase 0 prototype's delivery-service routes under `/api/e2ee`, for test data only. Always off with `NODE_ENV=production`; leave it off ([e2ee-prototype.md](e2ee-prototype.md)) |
| `PAYMENTS_ENABLED` | `false` | Unused (the old pay-to-unlock flag, replaced by [billing](billing.md)). |
| `IOS_PAIRING_ENABLED` | `false` | iPhone pairing ([docs/ios/architecture.md](ios/architecture.md)). Leave off until the iOS app is released: the server then refuses iPhone pairings with a clear "not yet" error, and the dashboard hides "Add an iPhone". |
| `APNS_BUNDLE_ID` | `org.plainphone.app` | APNs topic for iOS; override for custom builds ([push-setup.md](push-setup.md)) |
| `APPLE_APP_IDS` | `P7698GU4AV.org.plainphone.app` | iOS apps that open this server's login, pairing and invite links ([parent-app.md](parent-app.md)) |
| `ANDROID_APP_PACKAGE` | `org.plainphone.parent` | Android app that opens those links |
| `LATENCY_STATS` | `on` | Delivery timings (durations and provider names only) for `/api/latency` and the dashboard's "alerts usually arrive within" line. `off` records and shows nothing ([latency.md](latency.md)) |
| `METRICS_TOKEN` | | Bearer token (at least 24 random characters) for `GET /api/metrics`, the operator's delivery-speed numbers for Prometheus. Unset, or too short (dropped and reported), the endpoint answers 404. See [Watching delivery speed](#watching-delivery-speed) |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | | Optional. A Google OAuth client of type "Web application" for "Protect against reset" (factory reset protection with the parent's Google account). Create it in the Google Cloud console under Google Auth Platform → Clients, with the redirect URI `<PUBLIC_URL>/api/reset-protection/google/callback`. Enable **People API** for the Google Cloud project. Set both variables in the server environment. The server uses the `openid` and profile scopes to read only the numeric account ID from `people/me` and never requests an email address. Without it the dashboard says the feature is not set up |
| `ANDROID_APP_CERT_SHA256` | | SHA-256 fingerprints of that app's signing certificates, comma separated. Empty serves no Android statement |

The server image includes Bash and OpenSSL for Android system checks. If you run the server outside
the image, install both on a Unix host so certificate path verification can run via anonymous pipes.

## Backups

The compose file has a `backup` service that writes a `pg_dump` (custom format) to `./backups`
every 24 hours and keeps 14 daily and 8 weekly copies. For encrypted copies in an
existing S3-compatible bucket, see [Operations](operations.md#off-site-backups-and-recovery).
Restore a local dump:

```sh
docker compose exec -T db pg_restore -U plainphone -d plainphone --clean --if-exists < backups/plainphone-YYYY-MM-DD.dump
```

## Your own phone app

Sign in to the parent dashboard at your `PUBLIC_URL` and choose **Add phone**.
The strong-mode QR code and the light-mode setup link carry your server address.
The setup flow uses the released APK by default. If you build and sign your own
APK, set the download URL and signing checksum above.

The native parent app can also use your server. Build it with
`PLAINPHONE_SERVER_URL` set to your HTTPS address and follow the
[universal link setup](parent-app.md). The parent dashboard works in a browser.

Plainphone charges no fee for self-hosting. You cover the cost of your own
infrastructure and any services you use.

## Development

```sh
pnpm install
pnpm --filter @plainphone/server test     # starts an embedded PostgreSQL 18 if DATABASE_URL is unset
DATABASE_URL=postgres://... MAIL_PROVIDER=log pnpm dev:server
pnpm dev:web                              # Vite on :5173, proxies /api to :8080
```

Schema changes: edit `server/src/db/schema.ts`, then `pnpm --filter @plainphone/server db:generate`
and commit the new file in `server/drizzle/`.

## Native parent push and faster rule updates

Follow [push setup](push-setup.md) for Firebase and Apple credentials. Configure server secrets in the app container environment. To use the service-account file variant in Docker, add a read-only mount in a Compose override and set `FCM_SERVICE_ACCOUNT_FILE` to the container path. For example, mount a file from the host's secret directory at `/run/secrets/plainphone-fcm.json:ro`. The APK and parent app need their own Firebase client configuration only when building with FCM.

`PUSH_PROVIDER=none` (the default) keeps phone sync on polling. `fcm` prefers FCM if the server has credentials and the APK can acquire a token, with UnifiedPush as a fallback when allowed. `unifiedpush` uses UnifiedPush only. New Android phones start with **Faster rule updates** on when the server can wake phones; phones paired earlier keep their setting, and parents can switch it off per phone. To skip FCM for just one phone, enable **Wakeups without Google** for that phone and keep the server on `fcm` with UnifiedPush configured. The server can send native parent alerts with any of these settings.

## UnifiedPush with ntfy

1. On the push host, run [the ntfy Compose stack](../deploy/ntfy-compose.yaml) with `NTFY_BASE_URL=https://push.example.org`. For the project's hosted instance, use the planned push host and attach the service to the HTTPS reverse proxy so it can reach `ntfy:80`. Proxy streaming and WebSocket connections, and keep the ntfy data volume.
2. On the Plainphone server set `PUSH_EXTRA_HOSTS=push.example.org`. Allow only hosts you operate or explicitly trust to receive wake hints. Use a dedicated hostname. Set `PUSH_PROVIDER=unifiedpush` to skip FCM, or `fcm` to use ntfy as the fallback.
3. On the child phone install the [ntfy Android app](https://docs.ntfy.sh/subscribe/phone/) and configure the HTTPS base URL in its UnifiedPush distributor settings. For Google-free delivery use the F-Droid build and ntfy instant delivery. In the parent interface, check that **Faster rule updates** is on for the phone (new phones start with it on). If several distributors are installed, Plainphone keeps the one already registered, or prefers ntfy for a new registration.
4. Keep endpoint URLs private. They are capabilities. The example stack permits anonymous access for the distributor-generated topics and should run as a dedicated instance with normal proxy and ntfy rate limits. For the child wake channel, only a short reason goes through ntfy. Plainphone does not send names, rules or locations.

See [ntfy configuration](https://docs.ntfy.sh/config/) and the [UnifiedPush Android protocol](https://unifiedpush.org/developers/spec/android/).

## Watching delivery speed

The server can show you how fast alerts really travel, as p50 and p95 per path and push provider
over 1 h and 24 h, plus failed pushes per provider. It is off until you set a token:

1. Make a token: `openssl rand -base64 36` and set it as `METRICS_TOKEN` (never commit it).
2. Let Prometheus scrape it, with the token in a file:

   ```yaml
   scrape_configs:
     - job_name: plainphone
       metrics_path: /api/metrics
       scheme: https
       scrape_interval: 1m
       authorization:
         type: Bearer
         credentials_file: /etc/prometheus/plainphone-metrics-token
       static_configs:
         - targets: ["plainphone.example.org"]
   ```
3. In Grafana, import [`deploy/grafana/plainphone-latency.json`](../deploy/grafana/plainphone-latency.json)
   and pick that Prometheus.

Check by hand with `curl -H "Authorization: Bearer $METRICS_TOKEN" https://plainphone.example.org/api/metrics`.
The numbers hold no household, phone or user, and `LATENCY_STATS=off` empties them. What the
metrics mean and what they miss: [latency.md](latency.md#operator-metrics).

## Optional settings degrade, they do not crash

Only required settings (such as `DATABASE_URL`, and `DNS_API_URL` and `DNS_API_TOKEN` when `DNS_PROVIDER=http`) stop the server at startup. Invalid settings for FCM, APNs, Web Push (VAPID) or SMTP switch that integration off, log one line without the secret, and show up in `GET /api/health` as `push.errors` and `errors`. See [push setup](push-setup.md#invalid-settings-switch-a-provider-off-they-do-not-stop-the-server) for the accepted formats and messages.
