# Public alpha launch checklist

Plainphone is about to be shared publicly as an **alpha**: a link to this repository on
the maintainer's own profiles, so developers, curious parents and people interested in
calm phones can try it. It is not a 1.0 launch.

People who arrive from such a link should be able to tell, within a minute, what
Plainphone is, what state it is in, how to try it safely on a spare phone or an
emulator, and how to give feedback.

This page lists what must be true before the link is shared, what should follow soon
after, and what can wait until 1.0. Each item says its state today, with the file or URL
as evidence. State as of 22 November 2026, `main` at `7b89f1c3`, latest release
[v0.1.19](https://github.com/plainphone/plainphone/releases/tag/v0.1.19).

**Done** means it is in place. **Partly** means something exists but a gap remains.
**Missing** means nothing exists yet. Items fixed in the same change as this page are
marked *(fixed here)*. Everything else that is not done has an issue draft at the end.

## Must before sharing

### First impression

| Item | State | Evidence |
|---|---|---|
| README opens with what Plainphone is, for whom, and an image | Done | [README.md](../README.md), first three paragraphs and `site/src/og-en.png` |
| Status says "alpha" plainly, with the safety warning next to it | Done *(fixed here)* | README "Status: public alpha" block: spare phone or emulator only, not a child's only phone, no external audit, hosted service is a test service |
| Real screenshots of the phone and the dashboard | Done *(fixed here)* | README shows three screenshots from `site/src/img/` (home screen, stop screen, dashboard), the same images as plainphone.org. They use fictional names |
| A "try it in a few minutes" path without a factory reset | Done *(fixed here)* | README "Try it": light mode on a spare phone, an emulator path, and strong mode via [setup-test-phone.md](setup-test-phone.md). Light mode itself is documented in [light-mode.md](light-mode.md#installing-it-no-reset) |
| How to get out again is next to how to get in | Done *(fixed here)* | README "Try it" recommends the Child profile and lists Undo setup (10 minutes, no PIN, closed by a reboot), dashboard release (immediate for Child) and the maintenance PIN for light mode, warns that releasing a Myself phone waits for its key ([self-keys.md](self-keys.md)), and links the strong-mode exits including recovery reset in [setup-test-phone.md](setup-test-phone.md#5-getting-out-again) |
| The latest release is easy to find, with a checksum | Done | [Releases](https://github.com/plainphone/plainphone/releases): v0.1.19 has the APK, `plainphone-0.1.19.apk.json` with `sha256`, and the APK SHA-256 in the release notes. The signer certificate digest is in [README.md](../README.md#signing). The README "Try it" section now says how to check both |
| Releases are marked as pre-releases | Done | v0.1.17 to v0.1.19 are GitHub pre-releases. Consequence: `/releases/latest` on GitHub returns nothing, so the README links the release list, not "latest" |
| Release notes say what was tested on a physical phone | Partly | v0.1.19 says "Not yet tested on a physical phone." That is honest. A visitor needs to know which release to pick: see issue draft A1 |

### Feedback paths

| Item | State | Evidence |
|---|---|---|
| Bug report template | Done | [.github/ISSUE_TEMPLATE/bug.yml](../.github/ISSUE_TEMPLATE/bug.yml) |
| Feature idea template | Done | [.github/ISSUE_TEMPLATE/feature.yml](../.github/ISSUE_TEMPLATE/feature.yml), with the evidence field |
| "Bypass found" path | Done *(fixed here)* | A working bypass goes privately via [SECURITY.md](../SECURITY.md) and the contact link in [config.yml](../.github/ISSUE_TEMPLATE/config.yml). New: [test-report.yml](../.github/ISSUE_TEMPLATE/test-report.yml) for results from the [bypass checklist](bypass-checklist.md) and real-phone tests, which repeats the private route at the top |
| Translation template | Done *(fixed here)* | New: [translation.yml](../.github/ISSUE_TEMPLATE/translation.yml), pointing at [translations.md](translations.md) |
| Discussions open, with categories that match the docs | Done | <https://github.com/plainphone/plainphone/discussions> has Announcements, General, Ideas, Polls, Q&A and Show and tell. `config.yml` and [maintaining.md](maintaining.md) link Q&A and Ideas |
| A labelled set of `good first issue`s | Missing | The label exists, but no open issue has it (GitHub API, 22 November 2026). Five drafts below (G1 to G5) |
| Response expectations stated | Done | [maintaining.md](maintaining.md#triage): "usually within a few days … no guaranteed response time". [SECURITY.md](../SECURITY.md): "We aim to answer within a week" |
| Triage automation and a maintainer digest | Done | `.github/workflows/triage.yml` (`needs-triage`, `external`, acknowledgement), `.github/workflows/daily-digest.yml` |

### Safety and honesty

| Item | State | Evidence |
|---|---|---|
| What "alpha" means, in one place | Done *(fixed here)* | README status block and "Try it" section |
| Never on a child's only phone yet | Done | README status block, [self-hosting.md](self-hosting.md) top note, privacy page "Plainphone is early" |
| How to get out again | Done | [setup-test-phone.md](setup-test-phone.md#5-getting-out-again), [light-mode.md](light-mode.md#releasing-from-the-dashboard), the public [help page](https://plainphone.org/help/) on recovery reset |
| No external security audit, said plainly | Done | README "Privacy and security", [SECURITY.md](../SECURITY.md#end-to-end-encryption) |
| The hosted service can read data (no end-to-end encryption yet) | Done | README "Privacy and security", [privacy.md](privacy.md), [encryption.md](encryption.md) |
| What happens to data on the hosted test service, and whether and when it may be wiped | Missing | No page says whether the test service can be reset, or how users are warned first. [privacy.md](privacy.md) gives retention per data type and deletion via `DELETE /api/me`, not a test-service policy. This is a decision for the maintainer: issue draft S1 |

### Hosted service load and abuse

What exists today, from the code:

- **Sign-in** is by a link sent by mail (`POST /api/auth/request` in `server/src/routes/parent.ts`). Limits: 20 requests per IP per hour and 5 per email address per hour. Verifying a link: 30 per 15 minutes. All three are counted in the database.
- **The limits on paths that mail someone or create something** are counted in the database too (`DbRateLimiter` in `server/src/services/rate-limits.ts`, #270 and this change): pairing starts (10 per IP per hour), claiming a code (20 per 15 minutes), setup enrolment (30 per user per day from the dashboard, 20 per IP per hour on the phone), invitations (20 per user and 3 per recipient per day, plus `INVITES_PER_HOUSEHOLD_DAILY`) and extended-family links. They survive restarts and add up across processes ([operations.md](operations.md#rate-limits-in-the-database)).
- **The rest live in memory in one process** (`RateLimiter` in `server/src/lib/http.ts`), for example location requests (30 per hour), "more time" requests (6 per hour) and phone polling. They sit behind a session or a phone's token, or fire many times a minute; [operations.md](operations.md#rate-limits-in-the-database) lists them.
- **New households per day** can be capped with `SIGNUP_DAILY_CAP` (off by default, [operations.md](operations.md#daily-cap-on-new-households)). A new address that would go over the cap gets "Full for today" and no mail. There is still no overall cap on mail sent per hour or day.
- **Resources:** [deploy/dokploy-compose.yaml](../deploy/dokploy-compose.yaml) limits the app container to 768 MB and Postgres to 1 GB, and the database pool is 10 connections (`server/src/db/client.ts`).
- **Monitoring:** Uptime Kuma checks app health, DNS port 853, a DoT self-test every 5 minutes, the website and the backups. The public status page is <https://status.plainphone.org> ([operations.md](operations.md#monitoring-and-the-public-status-page)). Delivery speed has a Grafana dashboard in [deploy/grafana/](../deploy/grafana/) ([latency.md](latency.md)).

**If 500 people try it on one day.** 500 sign-ins send at least 500 mails. Phones fetch
their rules every 15 minutes, and every minute while the screen is on ([phone-sync.md](phone-sync.md)).
For 500 phones that is about 48,000 background fetches a day, plus about 60,000 more if each
screen is on for two hours: around 100,000 `GET /api/device/rules` a day, most of them
answered `304` from the `ETag` ([sync-api.md](sync-api.md)). A load test of a local copy of the
hosted setup carried 500 phones syncing every minute with a fifth of a core and 180 MiB, and
about 2,000 before the app's single thread became the limit ([operations.md](operations.md#capacity)).
What is not known:

| Item | State | Evidence |
|---|---|---|
| The mail provider's daily and hourly send limit, and what happens when it is reached | Missing | Not in the repo (provider settings are deploy configuration). Sign-in fails for everyone if the limit is hit. Issue draft L1 |
| A cap or alarm on new sign-ups per day | Done | `SIGNUP_DAILY_CAP` ([operations.md](operations.md#daily-cap-on-new-households)), #241. Phones per household: `HOUSEHOLD_PHONE_CAP` ([operations.md](operations.md#phones-per-household)) |
| A load test at 500 households and phones | Done | `scripts/load-test.sh`, results and limits in [operations.md](operations.md#capacity), #242. Measured on a test machine, not the production host |
| An alert on 5xx rate and slow responses for the app | Partly | Uptime Kuma checks that `/api/health` answers ([operations.md](operations.md)). Alerts on error rate and response time are not documented in the repo. Issue draft L4 |
| Abuse of the DNS filter: one account creating many ClientIDs | Done | Enrolment and pairing are rate limited per account and IP, counted in the database. `HOUSEHOLD_PHONE_CAP` caps phones per household whether billing is on or off: off by default for self-hosters, `10` on the hosted service through `deploy/dokploy-compose.yaml` ([operations.md](operations.md#phones-per-household)). Only adding a phone is checked. One person can still sign up with several addresses; `SIGNUP_DAILY_CAP` and the bot challenge bound that |

### Legal pages

| Item | State | Evidence |
|---|---|---|
| Privacy policy | Done | <https://plainphone.org/privacy/> in five languages, technical basis in [privacy.md](privacy.md), contact `privacy@plainphone.org` |
| Terms for the hosted test service | Missing | <https://plainphone.org/terms/> returns 404. Nothing says the service is provided as is, may change or stop, or who may use it. Issue draft T1 (needs the maintainer's decision, possibly legal review) |
| Licence | Done | [LICENSE](../LICENSE) (Apache-2.0), [NOTICE](../NOTICE) |
| Trademark policy | Done | [TRADEMARK.md](../TRADEMARK.md) |
| Contact and operator | Done | Site footer: Mahoje, CVR 39413892. `support@plainphone.org` on the help pages ([support.md](support.md)), `privacy@plainphone.org` on the privacy page, `/.well-known/security.txt` answers 200 |
| `support@plainphone.org` actually reaches a person | Partly | [support.md](support.md#launch-setup) asks for a test message before launch. Not verified for this checklist: issue draft T2 |

### Contributor experience

| Item | State | Evidence |
|---|---|---|
| Clone to running dev server on one page | Done *(fixed here)* | New "Run it locally" section in [CONTRIBUTING.md](../CONTRIBUTING.md). Checked on 22 November 2026: Postgres 18 in Docker, `MAIL_PROVIDER=log pnpm dev:server`, `/api/health` answered `ok` and the sign-in link was printed in the server log |
| CI on forks without secrets | Done *(fixed here, documented)* | `.github/workflows/ci.yml` runs on `pull_request` with `contents: read` and uses no `secrets.*`. CONTRIBUTING now says so. GitHub may ask a maintainer to approve the first run ([maintaining.md](maintaining.md)) |
| Code of conduct with a private reporting route | Done | [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) (Contributor Covenant, reports via private advisory titled "Conduct report") |
| PR template with verification and evidence | Done | [.github/pull_request_template.md](../.github/pull_request_template.md) |

## Should soon after

| Item | State | Evidence |
|---|---|---|
| A pinned "Welcome to the alpha" post in Discussions → Announcements | Missing | Issue draft F1 |
| Repository description, website and topics on GitHub | Missing | Not verifiable from the repo; set in GitHub's settings. Issue draft F2 |
| A short "known limitations" list a visitor can scan | Done | [limitations.md](limitations.md): what each mode cannot block, strong mode's requirements, what has not run on a real phone and how the Play edition differs, each linking to the details. Linked from the README status block and the help pages on plainphone.org in all five languages |
| Markdown link check for `docs/` and the README in CI | Missing | CI checks the built site's links (`site/scripts/check.mjs`) but not Markdown files. Good first issue G1 |
| Native review of Swedish, Norwegian Bokmål and German | Partly | [translations.md](translations.md#needs-native-review). Good first issues G2 to G4 |
| A recorded result of the bypass checklist on at least one real phone per release | Partly | [bypass-checklist.md](bypass-checklist.md#result-log) has a result log; v0.1.19 says it was not tested on a physical phone. Issue draft A1 |

## Later (before 1.0)

| Item | State | Evidence |
|---|---|---|
| External security audit | Missing | README and SECURITY.md say there has been none |
| End-to-end encryption in production | Missing | [encryption.md](encryption.md) is a specification, the [phase 0 prototype](e2ee-prototype.md) runs on test data only |
| A stable (non-pre-release) version and a support window | Missing | [SECURITY.md](../SECURITY.md#supported-versions): only the newest release is supported |
| Shared rate limits (Redis or the database) for more than one server process | Partly | Every limit on sign-in, pairing, setup, invitations and extended-family links is counted in the database, as are `SIGNUP_DAILY_CAP`, `INVITES_PER_HOUSEHOLD_DAILY` and `HOUSEHOLD_PHONE_CAP`. Limits behind a session or a phone's token, and the high-frequency ones, are still per process ([operations.md](operations.md#rate-limits-in-the-database)) |
| Real-phone test matrix across makers (Samsung, Xiaomi, Pixel, Android 10 to 16) | Partly | [android-versions.md](android-versions.md), [bypass-checklist.md](bypass-checklist.md) |
| Play Store listing and its policies | Partly | [light-mode.md](light-mode.md#google-play-policies-per-part), [support.md](support.md#launch-setup) |
| iPhone | Missing | README "Status and what's next" |

## Issue drafts

The orchestrator creates these issues. All labels below exist in the repository. The two new
issue templates use two labels that do not exist yet; create them first, or GitHub leaves new
reports unlabelled:

```sh
gh label create test-report -R plainphone/plainphone -c 0e8a16 -d "Results from trying Plainphone on a phone or an emulator"
gh label create translation -R plainphone/plainphone -c 5319e7 -d "A wrong, awkward or missing text in one of the five languages"
```

### A1. Say which release to try, and what was tested on a real phone

Labels: `documentation`

> Every release so far is a GitHub pre-release, and v0.1.19 says "Not yet tested on a physical phone". A visitor from the alpha announcement cannot tell which release to install or what has been checked on real hardware.
>
> - Add a line to each release's notes: "Recommended for testing: yes/no", and which phones and Android versions ran the bypass checklist, with a link to the row in `docs/bypass-checklist.md#result-log`.
> - Before sharing the repository, run the light-mode checks from the v0.1.19 notes on at least one physical phone and record the result.
>
> Done when the newest release says which phones it was tested on.

### S1. Decide and publish what happens to data on the hosted test service

Labels: `documentation`, `question`

> app.plainphone.org is a test service, but nothing says whether its data can be reset, how much notice users get, or what happens when testing ends. People who try the alpha will set up real accounts and phones.
>
> Decide (maintainer):
> - Can the test service be wiped? If yes, how much notice, and through which channel (mail to account holders, Discussions → Announcements, the status page)?
> - What happens to phones paired to it if the database is reset (they keep their last rules offline; how does the user get out)?
>
> Then write it in `docs/privacy.md`, the privacy page in `site/content/*.mjs` (all five languages) and the README status block.
>
> Done when the policy is published in all five languages.

### L1. Know the mail provider's sending limits before the alpha link goes out

Labels: `question`

> Sign-in is by mail only. Every sign-in from a new address sends one mail, and there is no cap on mail in the server. If the provider's hourly or daily limit is reached, nobody can sign in.
>
> - Find the provider's hourly and daily limits and the current daily volume.
> - Decide what is enough for a launch day (for example 500 new people, each signing in on two devices).
> - Add an alert when sending fails or nears the limit, and say in `docs/operations.md` what to do.
>
> This touches deploy configuration and the hosted service, so it is not repository work only.

### L2. Add a switchable daily cap on new accounts for the hosted service

Labels: `enhancement`, `security-hardening`

Done: the daily cap is `SIGNUP_DAILY_CAP` (#241), the phone cap is `HOUSEHOLD_PHONE_CAP` ([operations.md](operations.md#phones-per-household)). Kept for the record.

> There is no limit on new accounts per day, and none on phones per household while billing is off. A burst, or a script, could create many accounts, send many mails and register many DNS ClientIDs.
>
> Proposal: a server setting (off by default for self-hosters) that caps new accounts per day and phones per household on the hosted service. When the cap is reached, the sign-in page says "Plainphone is full for today, please try again tomorrow" in all five languages. An existing account always signs in. A phone that is already paired always syncs, and 112, SOS and release are never affected.
>
> Per the design rules this needs a setting with a one-line explanation and a sensible default, and docs in `docs/self-hosting.md` and `docs/operations.md`.
>
> Evidence: no direct evidence, reason: protects the shared service's mail and DNS capacity during a public test.

### L3. Load test the hosted setup at 500 households

Labels: `enhancement`

> Run `scripts/bench-server.sh` (and a sync-heavy variant) against a copy of the production setup with 500 households and 500 phones syncing every minute with the screen on. Record p50 and p95 for `/api/device/rules`, memory against the 768 MB container limit, and database connections against the pool of 10. Write the result and any limits to raise in `docs/operations.md`.

### L4. Document the app's 5xx and latency alerts in operations.md

Labels: `documentation`

> `docs/operations.md` lists the Uptime Kuma monitors, but nothing on alerts for error rate (5xx) and response time. Check what the operator's monitoring watches for app.plainphone.org, add an alert if there is none, and document what is watched and the thresholds, without internal addresses.

### T1. Add terms for the hosted test service

Labels: `documentation`, `question`

> https://plainphone.org/terms/ does not exist. The hosted service needs short, plain terms before strangers use it: it is a free test service provided as is, it can change or stop, it is not a replacement for supervising a child, what is not allowed (abuse, automated sign-ups), and who runs it (Mahoje, CVR 39413892) and how to reach them. Link it from the site footer, the sign-in page and the README.
>
> Needs the maintainer's decision on the wording and possibly legal review. All five site languages.

### T2. Check that support@plainphone.org and privacy@plainphone.org reach a person

Labels: `question`

> Both addresses are published (help pages, privacy page). Send a test message to each, confirm it arrives, and note the date in `docs/support.md#launch-setup`. Outside the repository: mail routing.

### F1. Post a pinned welcome in Discussions → Announcements

Labels: `documentation`

> A short post for people arriving from the alpha announcement: what Plainphone is, that it is an alpha, the "Try it" link in the README, where to ask (Q&A), where to report bugs (issues) and bypasses (private), and what kind of feedback helps most (test reports from real phones, translations). Pin it.

### F2. Set the GitHub repository description, website and topics

Labels: `documentation`

> Description: "A calm Android phone: calls, messages and the apps you need, without feeds. Alpha." Website: https://plainphone.org. Topics: `android`, `parental-controls`, `digital-wellbeing`, `device-owner`, `dns-filter`, `self-hosted`. Also upload `site/src/og-en.png` as the social preview image.

### F3. Collect the known limitations on one page

Labels: `documentation`

Done: [limitations.md](limitations.md). Kept for the record.

> What Plainphone cannot block today is spread over `docs/light-mode.md`, `docs/policies.md`, `docs/dns-bypass.md` and `docs/bypass-checklist.md`. Add `docs/limitations.md` with one short list per mode, linking to the details, and link it from the README status block.

### G1. Check links in Markdown files in CI

Labels: `good first issue`, `documentation`

> CI checks the links on the built website (`site/scripts/check.mjs`) but not in `README.md`, `CONTRIBUTING.md` or `docs/*.md`. Add a small, dependency-free Node script that checks every relative link and `#anchor` in those files, and run it in the `site` job (or a new small job) when Markdown files change. Update `.github/scripts/ci-changes.py` and its tests so the job runs for `*.md` changes.

### G2. Native review: Swedish help and setup pages

Labels: `good first issue`, `documentation`, `help wanted`

> `docs/translations.md` lists the Swedish texts that need a native speaker. Start with the help and setup pages on plainphone.org (`site/content/sv.mjs`, `site/content/help-translations.mjs`). Fix what reads awkwardly and note what you reviewed in `docs/translations.md`.

### G3. Native review: Norwegian Bokmål help and setup pages

Labels: `good first issue`, `documentation`, `help wanted`

> As G2, for Norwegian Bokmål (`site/content/nb.mjs`).

### G4. Native review: German help and setup pages

Labels: `good first issue`, `documentation`, `help wanted`

> As G2, for German (`site/content/de.mjs`).

### G5. Fill in the bypass checklist result log from a real phone

Labels: `good first issue`, `help wanted`

> Have a spare Android phone you can factory reset? Follow `docs/setup-test-phone.md`, work through `docs/bypass-checklist.md` and open a "Phone test report" issue with the results. A new way around the lock goes privately via SECURITY.md instead.
