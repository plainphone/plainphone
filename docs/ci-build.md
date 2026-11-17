# CI and build

The Android, Server and web, Parent app, DNS and Site workflows start on every
pull request and push to main. Each workflow detects changes before running its
checks. On an unrelated change, the existing jobs take a short success path
without checking out the repository, restoring caches or starting PostgreSQL.
If change detection fails, the workflow fails. A workflow edit runs all five
sets of checks. The Site deploy workflow has its own main-only trigger.

Android APK builds also watch the provisioning QR and release smoke scripts.
The phone sync integration test additionally watches the server, root workspace
inputs and its test driver. Parent app checks watch the OpenAPI spec and the PWA
files copied by `pnpm sync:shared`. Jobs for different components run in
parallel. Android debug and release checks share one Gradle invocation so they
can share setup and compilation. The server test and Docker smoke jobs also
run concurrently, with `pnpm -r build` running in Docker only.

The pnpm cache is scoped to each workspace lockfile. The server and web test
job saves the root store. Phone sync restores it and installs only the server
workspace, so a partial install cannot populate the shared key. The separate
Expo workspace uses its own lockfile and install. The Docker build uses its own layer cache and runs a frozen install
before building either workspace package. The `pnpm deploy --prod` output is
cached separately from the application source. The image contains its production
dependencies, compiled server, migrations, catalog and built PWA. It runs as
`node` and checks its health at `/api/health`. Main exports the BuildKit layer
cache to GitHub Actions. PR builds can restore it.

Gradle keeps its local build and configuration caches with `--no-daemon`.
`setup-gradle` restores Gradle user-home data in CI. Configuration-cache entries
are local to the workspace unless an encryption key is configured for CI
transfer. The Android workflows cache the requested platform and build-tools
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

1. On the CI PR, check that all existing job names complete and all checks run.
   Check Android debug and minified release APKs, both lint variants, QR tests,
   phone sync against PostgreSQL, and the APK and site artifacts. Compare job and
   step times against the baseline above.
2. Check that Buildx loads the image and that health, the PWA and pairing pass.
   The first main build populates the Docker cache. On the next eligible run,
   check the GHA cache import and whether the dependency layers are cached.
   Compare Android SDK cache restore time against SDK setup time and check
   Gradle and pnpm cache hits for both lockfiles.
3. On a later docs-only PR, verify that the existing required job names report
   success via “No relevant changes” and neither PostgreSQL service starts.
   On a server-only PR, verify that phone sync still runs and the APK build
   takes the success path. On an external-fork PR, verify that the change
   detector can read changed files with the read-only token.
4. Push another update to a test PR while checks are running and verify the
   older run cancels. Confirm the protected branch still requires the same
   checks. Main pushes use separate groups rather than cancelling each other.
