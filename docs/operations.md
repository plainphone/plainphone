# Off-site backups and recovery

Keep an encrypted backup of the application database and, when you run the DNS
stack, its AdGuard Home configuration in an existing S3-compatible bucket
outside the source host. Run one backup job per source. This also works when
the application and DNS run on different hosts.

## Check existing backups

Confirm the Dokploy database backup destination, latest successful run and
restore procedure in the Dokploy UI. The checked-in Dokploy Compose file mentions
object storage, but the destination and schedule are configured outside the
repo. A pre-deploy dump under `/root/backups/plainphone` or the self-hosting
Compose service's `./backups` directory only covers local recovery.

ppdns already snapshots `AdGuardHome.yaml` locally and can upload it using
`PPDNS_BACKUP_S3_*`. The encrypted job takes the same source file from the
AdGuard configuration volume. It holds the persistent clients, profile settings
and per-phone rules. Filter lists and certificates are regenerated. Keep a
separate protected copy of your deployment configuration and secrets, including
the DNS stack's environment file. After validating the encrypted job, review
any legacy DNS S3 uploads and their lifecycle, since that optional upload
stores the YAML in a gzip archive without client-side encryption.

## Configure each backup job

1. Choose an existing bucket and a dedicated prefix for this installation.
   Set S3 lifecycle expiration for `<prefix>/postgres/daily/` and
   `<prefix>/dns/daily/` to **14 days**, and for the corresponding `weekly/`
   prefixes to **56 days**. The first successful upload in each ISO week (UTC)
   writes both copies. Keep the status directory persistent so later runs in
   the same week only write the daily copy.
   For versioned buckets, also configure noncurrent version expiration and
   expired delete marker cleanup. Apply the rules alongside any existing rules
   and verify they are enabled. The S3 provider enforces expiration, so the
   scheduled credentials need only upload access to their own prefix (including
   multipart upload permissions if needed).
2. On a recovery machine, run `age-keygen -o plainphone-backup.agekey` and
   record the public recipient shown by `age-keygen -y plainphone-backup.agekey`.
   Keep the private identity in protected off-server storage accessible to
   recovery operators. When rotating recipients, keep old identities until
   their backups expire.
3. Build the job image from the repo root on the backup host.
   `docker build -f deploy/backup.Dockerfile -t plainphone-backup:local .`
4. Create a root-owned `/etc/plainphone-backup` directory and a mode-0600
   Docker env file per source, named `postgres.env` or `dns.env`. Create a
   separate writable status directory at `/var/lib/plainphone-backup/postgres`
   or `/var/lib/plainphone-backup/dns`. Use Docker env-file syntax
   (`KEY=value`, no shell quoting).

| Variable | Value |
| --- | --- |
| `BACKUP_MODE` | `postgres` or `dns`. When unset, the job logs that backup is unconfigured and exits successfully. |
| `BACKUP_S3_ENDPOINT` | HTTPS endpoint URL for your S3 provider. |
| `BACKUP_S3_BUCKET` | Existing bucket name. |
| `BACKUP_S3_PREFIX` | Installation prefix, e.g. `plainphone/hosted`. Use letters, digits, underscores and hyphens in each path segment. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | S3 upload credentials. |
| `AWS_DEFAULT_REGION` | Provider signing region. Defaults to `us-east-1`. |
| `BACKUP_AGE_RECIPIENT` | Public age recipient. |
| `BACKUP_STATUS_FILE` | `/status/last-success` with the systemd examples below. |
| `BACKUP_HEARTBEAT_URL` | Optional success URL. Use one monitor per job. Treat the URL as a secret. |
| `PGHOST`, `PGUSER`, `PGDATABASE` | Required for PostgreSQL. Within the app Compose network these default deployment values are `db`, `plainphone`, `plainphone`. |
| `PGPASSWORD`, `PGPORT`, `PGSSLMODE` | Standard libpq settings. Supply authentication and TLS as appropriate for the source connection. The default port is 5432. |
| `BACKUP_MIN_DUMP_BYTES` | Minimum custom-format dump size, default 1024 bytes. Calibrate it against the expected size of a healthy compressed dump. |
| `BACKUP_DNS_CONFIG` | DNS source file path, default `/dns/AdGuardHome.yaml`. |

The job uses PostgreSQL 18 client tools and needs temporary space for a dump
plus its encrypted copy. Files created during the run are owner-only and
cleaned up when the script exits. Use encrypted local storage for the work
directory if your deployment requires encryption for temporary files.

## Schedule and monitor

Save the PostgreSQL service example as
`/etc/systemd/system/plainphone-backup@postgres.service`. Substitute the real
Compose network attached to the `db` container for `APP_NETWORK` (inspect the
database container's network settings). The job connects via the Docker network.

```ini
[Unit]
Description=Plainphone PostgreSQL off-site backup
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
TimeoutStartSec=2h
ExecStart=/usr/bin/docker run --rm --name plainphone-backup-%i --network APP_NETWORK --env-file /etc/plainphone-backup/%i.env --mount type=bind,src=/var/lib/plainphone-backup/%i,dst=/status plainphone-backup:local
ExecStopPost=-/usr/bin/docker rm -f plainphone-backup-%i
```

For DNS, save a second copy as
`/etc/systemd/system/plainphone-backup@dns.service` with the description
`Plainphone DNS off-site backup` and this `ExecStart`. Substitute the actual
AdGuard configuration volume name if the Compose project name differs.

```ini
ExecStart=/usr/bin/docker run --rm --name plainphone-backup-%i --env-file /etc/plainphone-backup/%i.env --mount type=bind,src=/var/lib/plainphone-backup/%i,dst=/status --mount type=volume,src=plainphone-dns_conf,dst=/dns,readonly plainphone-backup:local
```

Save this shared timer as `/etc/systemd/system/plainphone-backup@.timer`.

```ini
[Unit]
Description=Daily Plainphone %i off-site backup

[Timer]
OnCalendar=*-*-* 03:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
```

Run `systemctl daemon-reload`, then `systemctl start plainphone-backup@postgres.service`
for the first run. Inspect `journalctl -u plainphone-backup@postgres.service`
and confirm that `last-success` contains an object that is visible in the bucket.
Enable the schedule with `systemctl enable --now plainphone-backup@postgres.timer`.
Repeat with `dns` on the DNS host if applicable.

Use an independent monitor such as an Uptime Kuma **Push** monitor with a
heartbeat interval of **26 hours** and a notification channel. Send the monitor
a first heartbeat through a successful run so it can start watching. The job
updates the status file and sends the heartbeat after all required uploads
succeed. A failed PostgreSQL connection, invalid or undersized dump, missing
DNS config or failed upload exits with an error and sends no success heartbeat.
A heartbeat delivery error also fails the job and is logged. If using the
status file for monitoring, alert when it is missing or older than 26 hours.

## Restore drill

Run the drill from an independent recovery machine at setup and regularly
thereafter. Use the same image build or the scripts with Bash, age, AWS CLI,
curl, Python 3, and PostgreSQL 18 client tools with libpq. Give the recovery
machine S3 read access to the prefix and access to the age identity. Keep the backup host's env file
out of the drill. Use a dedicated disposable PostgreSQL instance and create
an empty database before restoring. The helper refuses targets with existing
application schemas or objects and restores in a single transaction.

1. Choose a recent completed object from the bucket or from a job's
   `last-success` file. Use its path relative to `BACKUP_S3_PREFIX`.
2. Set the S3 variables from the table with **read** credentials. Set
   `RESTORE_DATABASE_URL` to your scratch database URL and run the command below.
   The helper passes connection details through a temporary owner-only libpq
   service file. For interactive setup, use a URL without a password and
   configure a PostgreSQL password file to keep credentials out of shell history.

   ```sh
   scripts/restore-backup.sh postgres/daily/YYYYMMDDTHHMMSSZ.dump.age /secure/plainphone-backup.agekey
   ```

3. Confirm expected migrated tables and compare aggregate counts with an
   expected range. Record UTC time, object key, recovery duration and outcome.
   Drop the scratch instance after verification according to your data-handling
   procedures.
4. For DNS, restore into a new private file and validate it against an isolated
   AdGuard Home instance before using it for recovery.

   ```sh
   scripts/restore-backup.sh dns/daily/YYYYMMDDTHHMMSSZ.yaml.age /secure/plainphone-backup.agekey ./recovered-AdGuardHome.yaml
   ```

The CI drill (`scripts/test-offsite-backup.sh`) dumps and restores a synthetic
row in a throwaway PostgreSQL 18 container, checks DNS YAML recovery and verifies
weekly catch-up and credential handling. It also checks that failed dumps leave
the status and heartbeat untouched. The AWS CLI uses a local HTTP fixture for
object transfers. The operational drill above verifies the actual bucket,
credentials and stored backups.

## Monitoring and the public status page

The hosted service is watched by [Uptime Kuma](https://github.com/louislam/uptime-kuma)
on the monitor host. The same instance serves the public status page at
<https://status.plainphone.org>, which the web dashboard, the parent app and
the website link to as "Status".

Monitors:

| Monitor | Type | What it checks |
| --- | --- | --- |
| App health | HTTP | The server's health endpoint answers. |
| DNS port 853 | TCP | The filter's DNS-over-TLS port accepts connections. |
| DoT self-test | Push | Real filtering works end to end (see below). |
| plainphone.org | HTTP | The website is up. |
| Backups | Push | One monitor per backup job, see [Schedule and monitor](#schedule-and-monitor). |

The DoT self-test is `python -m ppdns selftest`, run by ppdns every 5 minutes
(`PPDNS_SELFTEST_MINUTES`) with the DoT client in `dns/ppdns/dot.py`. It
connects over DoT with a hidden `monitor-…` ClientID and checks that
`example.com` resolves, that `googlesyndication.com` is blocked, that the
certificate AdGuard serves has at least 10 days left and that the last backup
is recent. ppdns reports the result to the Kuma push monitor in
`PPDNS_KUMA_PUSH_URL`. If no result arrives, the monitor goes down, so a
stopped self-test also alerts. Treat the push URL as a secret.

Alerts from Kuma go through the notify relay to the operator. Self-hosters can
use any Kuma notification channel.

## Daily cap on new households

`SIGNUP_DAILY_CAP` limits how many new households the server takes per UTC day. It is
off (`0`) by default, which is right for self-hosting. The hosted test service turns it
on so a busy launch day cannot flood its mail server: every sign-in from a new address
sends one mail.

How it counts:

- Households made since 00:00 UTC, plus new addresses that hold a login link they have
  not used yet (a link is valid for 15 minutes). So the cap limits mails as well as
  households, and an expired, unused link frees its place again.
- Everything is counted in the database, so the count survives restarts and holds across
  more than one server process.
- Never stopped: an address that already has an account, a parent with an open invitation
  to a household, and a trusted person chosen by email for a phone. They take no place
  either: their pending links are not counted, and the household of their own they get on
  first sign-in does not count while they hold the invitation, have joined another
  household as a parent, or are a trusted person on a phone. The store review address
  (`REVIEW_LOGIN_EMAIL`, [store-review.md](store-review.md)) is never stopped either: it
  gets no mail, and Play's reviewer must always get in.
- When the cap is full, `POST /api/auth/request` answers `429` with
  `code: "signup_cap_reached"`, `retryAt` (the next UTC midnight) and a `Retry-After`
  header, and no mail is sent. The dashboard and the parent app show "Full for today",
  ask the person to try again tomorrow, and link to the self-hosting guide.
- Trade-off: while the cap is full, the answer for a new address differs from the answer
  for a known one, so it tells whether an address has an account on that day only.

Sign-in links also have a limit per address: 5 per hour, counted in the database. The
check is not locked, so many requests at the very same moment can send a few more. The
limit per IP address (20 per hour) is in the database too, as a keyed hash that changes
every day, never the address itself ([Bot and spam protection](#bot-and-spam-protection)).

### Change it on the hosted service

1. Set `SIGNUP_DAILY_CAP` in the app's environment in Dokploy (the compose file passes
   it through; unset means `0`). Change only this variable, not the whole environment.
2. Redeploy the app. The value is read at start.
3. Check `GET /api/health` answers, then ask for a login link with a new test address:
   with the cap at `1` and one household made today, it should say "Full for today".

Set `0` to switch the cap off again.

### What to watch on launch day

- **Households made today**, in the database:

  ```sql
  select count(*) from households where created_at >= date_trunc('day', now(), 'UTC');
  ```

- **Places held by unused links**:

  ```sql
  select count(distinct email) from magic_links m
  where used_at is null and expires_at > now()
    and not exists (select 1 from users u where u.email = m.email);
  ```

- **Refusals**: the rate of `429` on `/api/auth/request` in the Traefik numbers in Grafana.
  A steady stream after midday UTC means the cap is full; raise it only if the mail server
  keeps up.
- **The mail server**: its queue and the provider's hourly and daily send limits. If mail
  is slow, lower the cap rather than raise it.
- **App health** in Uptime Kuma and memory against the container limit.

## Bot and spam protection

Every path where someone without an account, or with a brand-new one, can make the server send
mail or create something has its own protection. Each one can be switched off per server.

| Endpoint | What it does | Protection |
|---|---|---|
| `POST /api/auth/request` | Mails a sign-in link; a new address becomes a new household | IP limit 20/hour (database), address limit 5/hour (database), honeypot, bot challenge, throwaway-address check for new households, daily cap on new households |
| `POST /api/auth/verify` | Turns a link into a session; makes the household on first sign-in | IP limit 30/15 min (database), daily cap on new households |
| `POST /api/households/{hid}/invites` | Mails an invitation to a second parent (signed in) | Invitation cap per household, 3 invitations per address and household per day (database), 20 per inviting user per day (memory) |
| Trusted person by mail (`key.set` in the dashboard or the app, or chosen on the phone at setup) | Mails the trusted person an invitation | Invitation cap per household: over it, the key is still set and only the mail is skipped |
| `POST /api/device/pairings` | A phone starts pairing and gets a code (no mail) | IP limit 10/hour (database) |
| `POST /api/device/enroll`, `/enrollment-review`, `/enrollment-template` | A phone pairs with the one-time token from a setup link or QR code; `/enroll` can mail the trusted person chosen on the phone | Shared IP limit 20/hour (database), invitation cap per household on the mail |
| `POST /api/family-contact/invite`, `/accept`, `/decline` | An extended-family link is looked at, accepted or declined (no mail) | IP limit 30/15 min (database) |
| `POST /api/auth/review` | Store review sign-in, only with `REVIEW_LOGIN_EMAIL` set (no mail) | Its own limit ([store-review.md](store-review.md)) |

There is no contact or support form on the server or on plainphone.org: support goes by mail
to support@plainphone.org ([support.md](support.md)). Other mails (alerts, SOS, weekly summary,
approval requests) only go to people who are already in a household, triggered by its own
phones or parents.

### The switches

| Variable | Default | What it does |
|---|---|---|
| `BOT_CHALLENGE` | `off` | `altcha`: the dashboard and the parent app solve a short proof-of-work puzzle before a sign-in link is mailed. A misspelt value counts as `altcha` and is reported in `/api/health` |
| `BOT_CHALLENGE_DIFFICULTY` | `100000` | The largest number in the puzzle. The average work is half of it, SHA-256 hashes: about a tenth of a second in a browser, one or two seconds on a phone |
| `BOT_CHALLENGE_HMAC_KEY` | made by the server | Signs the puzzles. Unset, the server makes one on first use and keeps it in `server_secrets`. At least 32 characters; never logged |
| `SPAM_HONEYPOT` | `on` | A hidden field on the dashboard's sign-in form. Filled in, the answer is the normal "check your mail", nothing is sent, and the metrics count it |
| `BLOCK_DISPOSABLE_EMAIL` | `on` | A new household cannot start with a throwaway address. Accounts that exist, invited parents and trusted persons are never refused |
| `INVITES_PER_HOUSEHOLD_DAILY` | `20` | Invitation mails per household in any 24 hours, counted in the database. `0` switches it off |
| `SIGNUP_DAILY_CAP` | `0` | New households per UTC day ([above](#daily-cap-on-new-households)) |

The rate limits themselves have no switch: they only stop floods, and they were there before.

### The bot challenge

It is [ALTCHA](https://altcha.org) (protocol v1), implemented in the repository without a
package, a third party, cookies or tracking:

1. `GET /api/auth/challenge` hands out a random salt with an expiry 10 minutes ahead, and the
   SHA-256 of the salt plus a secret number up to `BOT_CHALLENGE_DIFFICULTY`, signed with HMAC.
   Nothing is stored.
2. The client tries every number until the hash matches (`packages/shared/src/altcha.ts`).
   The dashboard starts as soon as the sign-in page opens, so the answer is usually ready
   before the address is typed. The parent app solves it when the button is pressed, in small
   slices so the screen stays responsive, and shows "Doing a quick security check".
3. `POST /api/auth/request` checks the hash, the signature and the expiry, and stores the
   signature in `bot_challenges_spent` so the same answer is accepted once. The sweeper
   deletes spent signatures after their challenge has expired.

`/api/health` says `botChallenge: "altcha"` or `"off"` and `honeypot: true|false`, so clients
know what to send. A client that sends no answer gets `403` with
`code: "bot_challenge_required"` and a message that asks to update the app. The current app
and dashboard solve the puzzle and ask once more if the server switched it on after they read
`/api/health`. A wrong, expired or reused answer is `403 bot_challenge_failed`.

**Old parent apps cannot sign in while it is on.** A parent-app build from before the
challenge does not show the server's message: it maps an unknown `403` to its generic
"Something went wrong", with no hint to update, and no status code exists that it would turn
into a useful text. Existing sessions are not affected, only new sign-ins. So switch
`BOT_CHALLENGE=altcha` on only once the app version that solves it is the one in the stores
(and most parents have updated), and keep it `off` until then. The dashboard is served by the
server itself, so it is always new enough.

What it does and does not do: it makes each sign-in mail cost the sender a little CPU time,
which is nothing for a person and adds up for a script that wants thousands. It does not stop
a determined attacker with many machines; the database limits and the daily cap are the
backstop.

### Throwaway addresses

The list is [disposable-email-domains](https://github.com/disposable-email-domains/disposable-email-domains)
(CC0), vendored in `server/catalog/disposable-email/` and read once, on the first check. No lookup
happens over the network. A subdomain of a listed domain counts too; `allow.txt` lists
forwarding services people use as their lasting address and wins over the list. Refresh it
with `node server/scripts/update-disposable-domains.mjs`, read the diff and commit it.

A refused address gets `422` with `code: "disposable_email"`, and the form asks for an address
the person will keep, so they can still sign in later.

### Rate limits in the database

The limits in the table above are counted in `rate_limit_hits`, so they survive restarts and
hold across processes. A row holds the limit's name, the window and a count. The client is a
keyed hash: HMAC-SHA-256 of the address with a key derived from a server secret and the UTC
date, so the key changes every day and yesterday's rows cannot be matched with today's. IPv6
addresses are cut to their /64 first. The raw address is never stored, and rows are deleted
once their window has ended (at most a day). The other, high-frequency limits (phone polling,
receipts) stay in each process's memory.

### What to watch

- `/api/metrics` (with `METRICS_TOKEN`) has `plainphone_abuse_blocked_total{reason=…}` for
  `honeypot`, `bot_challenge`, `disposable_email`, `invite_cap` and `rate_limit`, counted since
  start-up. A sudden rise in `bot_challenge` or `honeypot` is a bot finding the form.
- The `403`, `422` and `429` rates on `/api/auth/request` in the Traefik numbers in Grafana.
- If real people report "the security check did not work", look for a clock that is far off
  on the server (the expiry is checked against it) or a proxy that caches `/api/auth/challenge`.
