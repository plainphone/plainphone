# Self-hosting the server and parent app

Plainphone's server and the parent web app (PWA) ship as one Docker image. PostgreSQL 18 holds
the data. The filtering DNS service is separate; see [self-hosting-dns.md](self-hosting-dns.md)
when it exists, or run without it (`DNS_PROVIDER=mock`).

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
see each client's own address. `PUBLIC_URL` must be the address parents open, because it goes into sign-in mails and the
pairing QR code.

## Connect the apps

In the native parent app, select **Use your own server** at sign-in or in Settings.
Enter the same HTTPS origin you set as `PUBLIC_URL`. The server must return
`ok: true` and `compatibility: 1` from `/api/health`. Sign in again after changing servers.

For a new Light setup without a dashboard QR, choose **Use your own server** on
the pairing step before generating the pairing code. When you use a setup link or
QR from your dashboard, the address is already included. Strong uses the address
from its provisioning QR. On Android, the address is shown under Maintenance
after the parent PIN is entered.

## Move to your own server

Selecting a different server in the parent app changes which account and dashboard
you open. Household export and transfer of already paired phones are not available yet.

If you are relocating a self-hosted instance you already operate, use a full
[database backup](#backups) and keep its existing HTTPS address and filter DNS
hostnames. Phones connect to the addresses they already know. Follow the
[DNS backup and restore guide](self-hosting-dns.md) if you are also relocating
the resolver.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | (set by compose) | PostgreSQL connection string |
| `PUBLIC_URL` | | Public address of the parent app |
| `MAIL_PROVIDER` | `none` | `none` sends nothing (nobody can sign in until you configure mail), `smtp` uses `SMTP_URL`. `log` prints mails to stdout and is refused in production |
| `SMTP_URL` | | e.g. `smtps://user:pass@smtp.example.org:465` |
| `MAIL_FROM` | `Plainphone <no-reply@plainphone.org>` | Sender |
| `DNS_PROVIDER` | `mock` | `http` talks to the DNS service (`DNS_API_URL`, `DNS_API_TOKEN`) |
| `DNS_HOST_SUFFIX` | `dns.plainphone.org` | Phones use `<clientId>.<suffix>` as private DNS |
| `APK_DOWNLOAD_URL` | | Where `/download/android` (the APK address in setup QR codes) redirects. Unset: the newest APK released in `APK_RELEASES_REPO` on GitHub |
| `APK_METADATA_URL` | | HTTPS URL for the metadata JSON matching `APK_DOWNLOAD_URL`. Optional, but enables a version check before download and update notifications in light mode. |
| `APK_RELEASES_REPO` | `plainphone/plainphone` | GitHub repository whose releases `/download/android` follows |
| `APK_SIGNATURE_CHECKSUM` | the project's production key (v0.1.10 and later) | base64url SHA-256 of the app's signing certificate, put in setup QR codes. Set it when you build and sign the app yourself |
| `PROVISIONING_DNS_HOST` | `family.adguard-dns.com` | Private DNS a phone uses from setup until its own filter host is ready |
| `TRUST_PROXY` | `false` | Use `X-Forwarded-For` for rate limits. Set `true` only behind a reverse proxy, with port 8080 not reachable directly |
| `MIGRATE_ON_START` | `true` | Apply database migrations when the server starts |
| `PAYMENTS_ENABLED` | `false` | Pay to unlock (not implemented yet) |
| `APPLE_APP_IDS` | `P7698GU4AV.org.plainphone.parent` | iOS apps that open this server's login, pairing and invite links ([parent-app.md](parent-app.md)) |
| `ANDROID_APP_PACKAGE` | `org.plainphone.parent` | Android app that opens those links |
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

Phones talk to the server set in the Plainphone app. To use your own server, build the app with
your server's URL (phase 4 documents the setting) and generate QR codes with your own APK.

## Development

```sh
pnpm install
pnpm --filter @plainphone/server test     # starts an embedded PostgreSQL 18 if DATABASE_URL is unset
DATABASE_URL=postgres://... MAIL_PROVIDER=log pnpm dev:server
pnpm dev:web                              # Vite on :5173, proxies /api to :8080
```

Schema changes: edit `server/src/db/schema.ts`, then `pnpm --filter @plainphone/server db:generate`
and commit the new file in `server/drizzle/`.
