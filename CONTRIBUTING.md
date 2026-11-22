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

## Setup per part

The JavaScript parts are one pnpm workspace with one lockfile: `server/`, `web/`, `parent-app/` and `packages/*` (Node 24 or newer, pnpm as pinned in `package.json`). Run `pnpm install` once at the root. `pnpm lint` there runs each package's `lint`: the TypeScript typecheck, and ESLint in the parent app. The web app and the parent app import shared copy, logic and API types from `packages/` (`@plainphone/i18n`, `@plainphone/shared`, `@plainphone/api-client`); change them there, never in a copy.

| Part | Requirements | Check before a PR |
|---|---|---|
| `android/` | JDK 21, Android SDK (see the [README](README.md#build-the-android-app)) | `./gradlew testDebugUnitTest lintDebug assembleDebug` |
| `server/` | PostgreSQL 18, `DATABASE_URL` pointing at a test database | `pnpm --filter @plainphone/server typecheck` and `test` |
| `web/` | | `pnpm --filter @plainphone/web typecheck` and `test` |
| `parent-app/` | See [docs/parent-app.md](docs/parent-app.md) | `pnpm typecheck`, `pnpm lint` and `pnpm test` in `parent-app/` |
| `packages/` | | `pnpm --filter @plainphone/i18n --filter @plainphone/shared --filter @plainphone/api-client typecheck`, and `pnpm --filter @plainphone/api-client test` |
| `server/openapi.yaml` | | `pnpm --filter @plainphone/api-client generate` after a change, then `check` (CI fails when the generated types are behind the spec) |
| `dns/` | Python 3, Docker for the full stack | `python3 -m unittest discover -s dns/tests -p 'test_ppdns.py'` and `dns/tests/run-stack.sh` |
| `site/` | Node only, no dependencies | `node build.mjs` and `npm run check` in `site/` |
| `scripts/` | Python 3 | `python3 -m unittest scripts/test_provisioning_qr.py` |

CI selects which checks to run based on the files changed in each pull request. Checks for unaffected areas report success after skipping their build and test steps. See [CI and builds](docs/ci-build.md) for the workflow details.

To run the server and the web app locally, use `pnpm dev:server` and `pnpm dev:web`, or Docker Compose as in [docs/self-hosting.md](docs/self-hosting.md).

## Commits and pull requests

- Write commit subjects in English, in the imperative, and keep them short: "Keep the parent PIN on the phone during light setup".
- Keep one logical change per commit, and explain the why in the body when it is not obvious.
- Fill in the pull request template, including how you verified the change and the `Evidence:` line.
- GitHub may require the maintainers to approve CI runs on pull requests from forks. A pull request usually gets an automated review. When CI is green and the review has no open blocking findings, it is usually labelled `awaiting-maintainer`. The maintainers decide whether to merge it.
- Update the documentation in `docs/` in the same pull request when behaviour changes.
- Copy for parents and children is calm and plain. Avoid judging language, streaks and rewards (principle 7).

## License

There is no contributor licence agreement (CLA) and no DCO sign-off. By submitting a contribution you agree it is licensed under the [Apache License 2.0](LICENSE) (section 5).
