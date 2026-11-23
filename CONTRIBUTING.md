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

The JavaScript parts are one pnpm workspace with one lockfile: `server/`, `web/`, `parent-app/` and `packages/*` (Node 24 or newer, pnpm as pinned in `package.json`). Run `pnpm install` once at the root. `pnpm lint` there runs each package's `lint`: the TypeScript typecheck, and ESLint in the parent app. The web app and the parent app import shared copy, logic and API types from `packages/` (`@plainphone/i18n`, `@plainphone/shared`, `@plainphone/api-client`); change them there, never in a copy.

The root scripts `pnpm build`, `pnpm typecheck`, `pnpm lint` and `pnpm test` run through [Turborepo](https://turborepo.dev). `turbo.json` declares each task's dependencies, inputs and outputs. Turborepo runs independent packages in parallel and replays a task from its local cache (`.turbo/cache`, not committed) when none of its inputs changed. It has no remote cache and needs no account.

- One package through the cache: `pnpm turbo run test --filter=@plainphone/web`. A package and everything that depends on it: `--filter=...@plainphone/shared`.
- Without the cache: `pnpm --filter <package> <script>` runs the script directly. To run every task again, add `--force` to `pnpm turbo run`.
- When a task starts reading a file outside its own package (as the server tests read `ios/Tests/Fixtures/` and `docs/encryption-test-vectors/`), add the file to that task's `inputs` in `turbo.json`. When a build starts depending on an environment variable, add it to the task's `env`. Otherwise the cache can replay a result from before the change.
- Regenerate the API types with `pnpm turbo run generate --filter=@plainphone/api-client`, or `pnpm --filter @plainphone/api-client generate`.

| Part | Requirements | Check before a PR |
|---|---|---|
| `android/` | JDK 21, Android SDK (see the [README](README.md#build-the-android-app)) | `./gradlew testGithubDebugUnitTest lintGithubDebug assembleGithubDebug` |
| `server/` | PostgreSQL 18, `DATABASE_URL` pointing at a test database | `pnpm --filter @plainphone/server typecheck` and `test` |
| `web/` | | `pnpm --filter @plainphone/web typecheck` and `test` |
| `parent-app/` | See [docs/parent-app.md](docs/parent-app.md) | `pnpm typecheck`, `pnpm lint` and `pnpm test` in `parent-app/` |
| `packages/` | | `pnpm --filter @plainphone/i18n --filter @plainphone/shared --filter @plainphone/api-client typecheck`, and `pnpm --filter @plainphone/api-client test` |
| `server/openapi.yaml` | | `pnpm --filter @plainphone/api-client generate` after a change, then `check` (CI fails when the generated types are behind the spec) |
| `dns/` | Python 3, Docker for the full stack | `python3 -m unittest discover -s dns/tests -p 'test_ppdns.py'` and `dns/tests/run-stack.sh` |
| `site/` | Node only, no dependencies | `node build.mjs` and `npm run check` in `site/` |
| `scripts/` | Python 3 | `python3 -m unittest scripts/test_provisioning_qr.py` |
| `*.md` | Node only, no dependencies | `node scripts/check-markdown-links.mjs` checks every relative link and `#anchor` (external links are not checked) |

CI selects which checks to run based on the files changed in each pull request. Checks for unaffected areas report success after skipping their build and test steps. In the server and parent app jobs, Turborepo replays the tasks whose inputs did not change from a cache that CI keeps between runs. See [CI and builds](docs/ci-build.md) for the workflow details.

To run the server and the web app locally, see [Run it locally](#run-it-locally) above, or use Docker Compose as in [docs/self-hosting.md](docs/self-hosting.md).

## Commits and pull requests

- Write commit subjects in English, in the imperative, and keep them short: "Keep the parent PIN on the phone during light setup".
- Keep one logical change per commit, and explain the why in the body when it is not obvious.
- Fill in the pull request template, including how you verified the change and the `Evidence:` line.
- CI needs no secrets, so it runs the same checks on a pull request from a fork as on the maintainers' own branches. GitHub may require the maintainers to approve CI runs on pull requests from forks. A pull request usually gets an automated review. When CI is green and the review has no open blocking findings, it is usually labelled `awaiting-maintainer`. The maintainers decide whether to merge it.
- Update the documentation in `docs/` in the same pull request when behaviour changes.
- Copy for parents and children is calm and plain. Avoid judging language, streaks and rewards (principle 7).

## License

There is no contributor licence agreement (CLA) and no DCO sign-off. By submitting a contribution you agree it is licensed under the [Apache License 2.0](LICENSE) (section 5).
