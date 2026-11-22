# Contributing to Plainphone

Thank you for helping. Bug reports, test results from real phones, documentation fixes and code are all welcome.

[How we handle your contribution](docs/maintaining.md) explains what happens after you open an issue, a pull request or a discussion: triage, labels, review and who decides on a merge.

Questions and ideas that are not concrete yet belong in [Discussions](https://github.com/plainphone/plainphone/discussions). Issues are for bugs and concrete tasks.

## Before you start

Follow the [design principles](docs/design-principles.md) and consult the
[evidence review](docs/evidence.md) when changing how Plainphone works.

Every user-facing feature states its evidence in the PR. On the `Evidence:`
line, cite a study, review or official recommendation and explain how it
applies. If there is no direct evidence, write `no direct evidence, reason: …`
and explain the design choice and its uncertainty.

For a larger change, open an issue first so we can agree on the approach.

Found a way around the lock, or a privacy flaw? Do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Run it locally

From a fresh clone to the server and the parent web app on your machine. You need Node 24 or newer, pnpm (`corepack enable` picks the pinned version) and Docker for the database.

```sh
git clone https://github.com/plainphone/plainphone
cd plainphone
pnpm install

# A throwaway PostgreSQL 18 on localhost:5432
docker run -d --name plainphone-dev-db -e POSTGRES_PASSWORD=dev -p 127.0.0.1:5432:5432 postgres:18

# Terminal 1: the API on :8080. Migrations run at start-up. Mails are printed, not sent.
DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres MAIL_PROVIDER=log pnpm dev:server

# Terminal 2: the parent web app on http://localhost:5173
pnpm dev:web
```

Open <http://localhost:5173> and sign in with any address. The sign-in link appears in terminal 1. `curl localhost:8080/api/health` should answer `"ok":true`. Stop the database with `docker rm -f plainphone-dev-db`.

To pair a phone or an emulator with this server, see [Your own phone app](docs/self-hosting.md#your-own-phone-app). The server tests (`pnpm --filter @plainphone/server test`) start their own embedded PostgreSQL, so they do not need Docker.

## Setup per part

The JavaScript parts are a pnpm workspace (Node 24 or newer, pnpm as pinned in `package.json`). Run `pnpm install` once at the root. `pnpm lint` there runs each package's `lint`, which is its TypeScript typecheck (there is no separate linter).

| Part | Requirements | Check before a PR |
|---|---|---|
| `android/` | JDK 21, Android SDK (see the [README](README.md#build-the-android-app)) | `./gradlew testDebugUnitTest lintDebug assembleDebug` |
| `server/` | PostgreSQL 18, `DATABASE_URL` pointing at a test database | `pnpm --filter @plainphone/server typecheck` and `test` |
| `web/` | | `pnpm --filter @plainphone/web typecheck` and `test` |
| `parent-app/` | See [docs/parent-app.md](docs/parent-app.md) | `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm check:api` and `pnpm check:shared` in `parent-app/` |
| `dns/` | Python 3, Docker for the full stack | `python3 -m unittest discover -s dns/tests -p 'test_ppdns.py'` and `dns/tests/run-stack.sh` |
| `site/` | Node only, no dependencies | `node build.mjs` and `npm run check` in `site/` |
| `scripts/` | Python 3 | `python3 -m unittest scripts/test_provisioning_qr.py` |

CI selects which checks to run based on the files changed in each pull request. Checks for unaffected areas report success after skipping their build and test steps. See [CI and builds](docs/ci-build.md) for the workflow details.

To run the server and the web app locally, use `pnpm dev:server` and `pnpm dev:web`, or Docker Compose as in [docs/self-hosting.md](docs/self-hosting.md).

## Commits and pull requests

- Write commit subjects in English, in the imperative, and keep them short: "Keep the parent PIN on the phone during light setup".
- Keep one logical change per commit, and explain the why in the body when it is not obvious.
- Fill in the pull request template, including how you verified the change and the `Evidence:` line.
- CI needs no secrets, so it runs the same checks on a pull request from a fork as on the maintainers' own branches. GitHub may require the maintainers to approve CI runs on pull requests from forks. A pull request usually gets an automated review. When CI is green and the review has no open blocking findings, it is usually labelled `awaiting-maintainer`. The maintainers decide whether to merge it.
- Update the documentation in `docs/` in the same pull request when behaviour changes.
- Copy for parents and children is calm and plain. Avoid judging language, streaks and rewards (principle 7).

## License

There is no contributor licence agreement (CLA) and no DCO sign-off. By submitting a contribution you agree it is licensed under the [Apache License 2.0](LICENSE) (section 5).
