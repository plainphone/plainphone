# CI and build

The CI workflow starts on every pull request and push to main, and nightly at
02:17 UTC on main. The nightly run enables only the `e2ee-prototype` check (the
detector's `nightly` mode), and every other job reports success without work. One job
computes the tree diff for the run. On pull requests it compares the checked-out
merge commit with its first parent, so reruns use the same changed files even
after the pull request moves. On pushes it compares the previous and current
commit, and runs all checks when the previous commit is unavailable. Workflow
and detector changes run all checks. Site deploy has its own main-only trigger.

The regular check jobs report success on unrelated changes without checking out the
repository, restoring caches or starting PostgreSQL. A detector failure fails
the check jobs, including when the detector emits missing or invalid outputs.
A docs-only change starts seven runners (one detector and six short check
jobs), down from twelve in the initial split-workflow version.
Before path filtering, the same change started four runners that ran the full
Android and server workflows. These counts include the short success jobs.
Elapsed and billed time also depend on queue and runner startup time.

Android checks also watch the provisioning QR and release smoke scripts,
`web/test-fixtures/*` for shared enrollment fixtures, and
`docs/encryption-test-vectors/*` and `packages/crypto*` for Kotlin vector tests.
Phone sync additionally watches the server, root workspace inputs and its
test driver. The [Android emulator suite](testing.md) runs on every main push
and on pull requests touching its Android, server, workflow or test inputs.
It caches a clean AOSP snapshot for API 34 (API 29 cold-boots every run, see
[testing](testing.md)) and keeps the screenshot
and logs when a device flow fails. Parent app checks watch the app, the OpenAPI spec, the root workspace files
and the packages the app shares with the PWA (`packages/i18n`, `shared` and
`api-client`). Server checks also watch the root workspace packages
and encryption test vectors, which run in the TypeScript workspace suite, and
fail when `packages/api-client/src/schema.d.ts` is behind `server/openapi.yaml`.
Phone sync and the emulator suite skip changes to the shared client packages.
DNS checks watch the server schema and validation
files mirrored by `dns/ppdns/profiles.py`. Independent jobs run in parallel.
Debug and release APK checks share one Gradle invocation. The Docker smoke job
runs concurrently with server, web and phone sync checks, with `pnpm -r build`
running in Docker only.

The server and parent app jobs run their JavaScript checks through Turborepo
(`turbo.json`) with the same step names as before: typecheck, tests and the API
types check in the server job, and typecheck, lint, tests and the bundle export in
the parent app job. The path filters above still decide whether a job runs. Inside a
job, Turborepo replays every task whose inputs did not change from its local cache,
so a change to the web app reruns only the web typecheck and tests, not the server
tests. The server tests' hash also includes the PostgreSQL service image and its exact
version, so a new image reruns them. The parent app's typecheck, lint and tests also
hash `ios/Tests/Fixtures/`, which its iPhone tests import. The bundle export is cached
as a passed check without storing the bundles, and the local cache is capped at 500 MB
so the Turborepo entries do not push the Android caches out of the repo's cache budget. Each job restores `.turbo/cache` with `actions/cache` and saves a new entry
after the checks, also when a check failed, because Turborepo stores only tasks that
passed. The key includes the runner and the exact Node version, so a Node update
starts with an empty cache. Pull requests restore the newest entry from main or from
their own earlier runs. There is no remote cache. A manual `workflow_dispatch` run
sets `TURBO_FORCE` and runs every task again. A change to `turbo.json` runs the
server and parent app jobs.

The jobs do not use `turbo --affected`. It maps changed files to packages, and
several checks read files outside their package: the API types check reads
`server/openapi.yaml`, the server and parent app tests read
`ios/Tests/Fixtures/`, and the server tests read the compose files, `.env.example` and `docs/encryption-test-vectors/`. Those files
are task `inputs` in `turbo.json`, so the cache hash covers them, while
package-level change detection would skip the check.

Server and web tests share the installed root workspace and one PostgreSQL
service with phone sync. Each test suite uses its own database. The root
workspace install saves the pnpm store under its lockfile key. On phone-only
changes, a filtered install restores the same store without saving a partial
store under that key. The separate Expo workspace uses its own lockfile and
install. The Docker build uses its own layer cache and runs a frozen install
before building either workspace package. The `pnpm deploy --prod` output is
cached separately from the application source. The image contains its production
dependencies, compiled server, migrations, catalog and built PWA. It runs as
`node` and checks its health at `/api/health`. Main exports the BuildKit layer
cache to GitHub Actions. PR builds can restore it.

Gradle keeps its local build and configuration caches with `--no-daemon`.
`setup-gradle` restores Gradle user-home data in CI. Configuration-cache entries
are local to the workspace unless an encryption key is configured for CI
transfer. The Android jobs cache the requested platform and build-tools
directories when the hosted runner does not already have them.

The Android app has one flavor dimension, `distribution`, so every task name
carries the flavor ([play/play-edition.md](play/play-edition.md)):

- `github` (the default) is the app on GitHub Releases and F-Droid. The Android
  job builds `assembleGithubDebug assembleGithubRelease`, runs
  `testGithubDebugUnitTest lintGithubDebug lintGithubRelease` and smoke-tests the
  minified release APK. Phone sync, the E2EE prototype check and the emulator
  suite build this flavor too (`:app:assembleGithubDebug
  :app:assembleGithubDebugAndroidTest`). It compiles `app/src/github`, has no
  billing dependency and never shows a paid offer.
- `play` is the Google Play edition. A second step in the same job builds
  `assemblePlayRelease bundlePlayRelease` unsigned (CI has no upload key), runs
  `testPlayDebugUnitTest lintPlayDebug`, and `scripts/smoke-play-apk.sh` checks the
  APK: the manifest has no `QUERY_ALL_PACKAGES`, `REQUEST_INSTALL_PACKAGES`,
  install watchdog or Device Owner provisioning, it declares `isMonitoringTool`
  and `<queries>` for launcher apps, and the dex has no update check or link to
  the APK download. It compiles `app/src/play`, which adds the Google Play
  Billing Library the paid early unlock needs (docs/billing.md).

Tests in `app/src/test` run for both flavors. `app/src/testGithub` holds the
Myself setup screens, and `app/src/testPlay` the Play edition's own tests. A few
self-updater tests in `app/src/test` are skipped on `play` with
`assumeTrue(Distribution.SELF_UPDATES)`. `PlayStoreSourcesTest` reads
`app/src/play` as text and fails if it mentions Stripe, a checkout URL, or
finishes (acknowledges or consumes) a purchase itself, which only the server may
do.

`-PplainphoneFcm=true` adds Firebase push to either flavor (docs/push-setup.md).

## Baseline and comparison

Job durations are elapsed seconds from the public GitHub Actions jobs API.
They are sample runs, not averages or billed minutes. The jobs API reports
step durations but does not report cache hits. Authenticated logs were
unavailable for the baseline.

| Workflow / job | Before | After on unrelated changes |
| --- | ---: | --- |
| [Android](https://github.com/plainphone/plainphone/actions/runs/44177830826) / build | 175 s | No SDK or Gradle setup, APK build, lint, unit tests or artifact upload |
| Android / phone-sync-e2e | 89 s | No PostgreSQL, workspace install or Android setup |
| [Server and web](https://github.com/plainphone/plainphone/actions/runs/44177830831) / test | 58 s | No PostgreSQL, workspace install, typecheck or tests |
| Server and web / docker | 25 s | No image build or smoke test |
| [Parent app](https://github.com/plainphone/plainphone/actions/runs/44177830908) / check | 106 s | No Expo setup, install, checks or bundle export |
| [DNS](https://github.com/plainphone/plainphone/actions/runs/43973199989) / test | 106 s | No unit tests or DNS-over-TLS stack |
| [Site](https://github.com/plainphone/plainphone/actions/runs/44177830925) / build | 24 s | No site build, link checks or artifact upload |
| [Site deploy](https://github.com/plainphone/plainphone/actions/runs/44178335707) / deploy | 22 s | Existing deployment trigger |

Android SDK setup took 8–16 s in the sample. Gradle setup took 10 s in each
Android job. The root pnpm install step took 1 s in each job and the parent
app's install took 3 s. The Docker build step took 14 s. Actual post-change CI
durations and cache-hit rates require hosted runs.

The local Docker comparison used the same checkout and Docker host (linux/amd64).
The first builds used available local cache layers. For the source-only rebuild,
both Dockerfiles used the same temporary context with a comment added to the
server entry point. Sizes are the uncompressed image size from
`docker image inspect --format '{{.Size}}'`.

| Measurement | Before | After |
| --- | ---: | ---: |
| Image size | 253,143,659 bytes | 194,774,417 bytes |
| First local build, with available cache | 34.4 s | 23.4 s |
| Source-only rebuild with warm dependency layers | 33.6 s | 8.6 s |

The local Android debug APK, unit test and lint command took 4m 15s when
creating a configuration-cache entry (25 tasks restored from the build
cache). A repeat reused the configuration and finished in 24s (55 tasks
up to date). Both ran with `--no-daemon`. These runs show local reuse and do
not measure a change in hosted Android job time.

## First GitHub runs

1. On the CI PR, verify all six check jobs (`android`, `server-and-phone-sync`,
   `docker`, `parent-app`, `dns` and `site`) and the `changes` job. Confirm debug and minified release APKs, both lint variants, QR
   tests, phone sync against PostgreSQL, and APK and site artifacts. Compare
   job and step times against the baseline above, including job setup.
2. Check that Buildx loads the image and that health, the PWA and pairing pass.
   The first main build populates the Docker cache. On the next eligible run,
   check the GHA cache import and whether the dependency layers are cached.
   Compare Android SDK cache restore time against SDK setup time and check
   Gradle and pnpm cache hits for both lockfiles.
3. On a docs-only PR, verify that all check jobs report success via
   “No relevant changes” and PostgreSQL does not start. On a server-only PR,
   verify that phone sync shares the root pnpm install with server and web
   checks while the APK build takes the success path. On a fork PR, confirm
   that the read-only checkout can diff the merge commit. Push a new revision
   that removes a previously tested Android change, then rerun the earlier
   revision and confirm it still runs the Android checks.
4. Push another update to a test PR while checks are running and verify the
   older run cancels. If branch protection or a ruleset requires status checks,
   use the current CI job names. Main pushes have separate concurrency groups.
