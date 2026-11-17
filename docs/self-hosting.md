# Self-hosting the server and parent app

Plainphone's server and the parent web app (PWA) ship as one Docker image. PostgreSQL 18 holds
the data. The filtering DNS service is separate; see [self-hosting-dns.md](self-hosting-dns.md)
when it exists, or run without it (`DNS_PROVIDER=mock`).

> Status: early. It runs and is tested, but phones do not yet use the server (phase 4 connects
> them). Do not rely on it for a real child's phone yet.

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
| `TRUST_PROXY` | `false` | Use `X-Forwarded-For` for rate limits. Set `true` only behind a reverse proxy, with port 8080 not reachable directly |
| `MIGRATE_ON_START` | `true` | Apply database migrations when the server starts |
| `PAYMENTS_ENABLED` | `false` | Pay to unlock (not implemented yet) |
| `APPLE_APP_IDS` | `P7698GU4AV.org.plainphone.parent` | iOS apps that open this server's login, pairing and invite links ([parent-app.md](parent-app.md)) |
| `ANDROID_APP_PACKAGE` | `org.plainphone.parent` | Android app that opens those links |
| `ANDROID_APP_CERT_SHA256` | | SHA-256 fingerprints of that app's signing certificates, comma separated. Empty serves no Android statement |
| `FCM_SERVICE_ACCOUNT_JSON` | | Push to the Android app: the service account JSON (or its base64) of the Firebase project in the app's `google-services.json`. Empty: no Android push |
| `APNS_KEY_P8`, `APNS_KEY_ID` | | Push to the iOS app: an APNs auth key (`.p8`, PEM or base64) and its key id. Empty: no iOS push |
| `APNS_TEAM_ID`, `APNS_TOPIC` | from `APPLE_APP_IDS` | Team of the APNs key and the app's bundle id, if they differ from the first `APPLE_APP_IDS` entry |
| `APNS_ENVIRONMENT` | `production` | `sandbox` for app builds run from Xcode |

## Backups

The compose file has a `backup` service that writes a `pg_dump` (custom format) to `./backups`
every 24 hours, keeps 14 daily and 8 weekly copies. Copy `./backups` off the machine. Restore:

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
