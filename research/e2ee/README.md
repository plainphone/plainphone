# E2EE experiment for issue #120

Throw-away harnesses that compare OpenMLS with a Matrix SDK fallback for
Plainphone family messages. Nothing here is wired into the app, the server or
CI. The findings and the recommendation are in
[docs/research/e2ee-recommendation.md](../../docs/research/e2ee-recommendation.md).
The last full run is in [results.txt](results.txt).

All users, devices and texts are synthetic (`parent-a-phone`, `child-phone`,
`SYNTH-CANARY …`). The fake servers run in-process; nothing calls a real
service.

| Folder | What it runs |
|---|---|
| [`mls-harness`](mls-harness) | OpenMLS 0.9.2: 10 scenarios with four devices and a fake delivery server (`src/main.rs`, `src/world.rs`), plus the cross-runtime steps (`src/cross.rs`) |
| [`matrix-harness`](matrix-harness) | vodozemac 0.11.2 (Olm + Megolm) used the way matrix-sdk-crypto uses it, same 10 scenarios |
| [`matrix-sdk-probe`](matrix-sdk-probe) | matrix-sdk-crypto 0.19.1 `OlmMachine` through its public API against an in-process homeserver: 5 scenarios about the SDK's own defaults |
| [`scripts`](scripts) | `run-all.sh`, `cross-runtime.sh` (native ⇄ wasm32 in Node), `sizes.sh` (Android arm64, wasm32), `audit_deps.py` (licences, build scripts, crate ages) |

## Run

Needs Rust (tested with 1.99.1), the `wasm32-unknown-unknown` and
`aarch64-linux-android` targets, `wasm-bindgen-cli` 0.2.130 on `PATH`, an
Android NDK (`ANDROID_NDK_HOME` or `~/android-sdk/ndk/<version>`) and Node 24.

```sh
rustup target add wasm32-unknown-unknown aarch64-linux-android
cargo install wasm-bindgen-cli --version =0.2.130 --locked --root ~/tools/wasm-bindgen
PATH="$HOME/tools/wasm-bindgen/bin:$PATH" research/e2ee/scripts/run-all.sh
```

Each harness exits non-zero when an expectation fails. A single harness:
`cd research/e2ee/mls-harness && cargo run --release`.

## Why this is not in CI

The pnpm and Gradle checks stay as they are. The harnesses fetch about 200
crates each, need extra toolchains and take minutes, so they are neither fast
nor hermetic. Run `scripts/run-all.sh` by hand when the comparison needs to be
repeated, for example after a version bump.

## Dependency hygiene

Versions are pinned with `=` and the lockfiles are committed. Before the first
build, `scripts/audit_deps.py <crate> --ages` lists licences and build scripts
and flags every lockfile entry younger than three days. Five such crates
(pin-project-lite 0.2.18, regex 1.13.2, regex-automata 0.4.19, regex-syntax
0.8.12, smallvec 1.16.6) and cc 1.11.3 were pinned back to their previous
releases. See the recommendation for the licence findings.
