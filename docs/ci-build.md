# CI and build

The CI workflow starts on every pull request and push to main. One job
computes the tree diff for the run. On pull requests it compares the checked-out
merge commit with its first parent, so reruns use the same changed files even
after the pull request moves. On pushes it compares the previous and current
commit, and runs all checks when the previous commit is unavailable. Workflow
and detector changes run all checks. Site deploy has its own main-only trigger.

Each check job reports success on unrelated changes without checking out the
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
test driver. Parent app checks watch the OpenAPI spec and the PWA files copied
by `pnpm sync:shared`. Server checks also watch the root workspace packages
and encryption test vectors, which run in the TypeScript workspace suite.
DNS checks watch the server schema and validation
files mirrored by `dns/ppdns/profiles.py`. Independent jobs run in parallel.
Debug and release APK checks share one Gradle invocation. The Docker smoke job
runs concurrently with server, web and phone sync checks, with `pnpm -r build`
running in Docker only.

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
