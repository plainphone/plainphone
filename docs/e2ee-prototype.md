# E2EE phase 0: OpenMLS prototype

Status: **prototype for the independent review** (issue #120). Test data only.
Nothing here is on in production, and nothing reaches a family. Free text
(#121) stays off until the review in the
[recommendation](research/e2ee-recommendation.md#checklist-for-the-independent-review)
has recorded an outcome.

The prototype builds the design the recommendation proposes, so a reviewer can
read and run real code instead of a description: OpenMLS (RFC 9420) on the
clients, the Plainphone API as the delivery service, and every device bound to
the household roster.

## What is in it

| Part | Where | Switch |
|---|---|---|
| OpenMLS core: one JSON entry point, all Plainphone checks | [`e2ee/mls-core`](../e2ee/mls-core/README.md) | Not linked into any release build |
| Phone binding (JNI, one native function) | `android/app/src/debug/java/org/plainphone/app/e2ee/MlsCore.kt` | Debug source set only; the `.so` is packaged only with `-PplainphoneE2eePrototype=true` |
| Delivery service (key packages, Welcome, commit and text fan-out, ordering, size limits) | `server/src/routes/e2ee.ts`, `server/src/lib/mls-wire.ts`, `server/src/db/e2ee-schema.ts` | `E2EE_PROTOTYPE_ENABLED`, default `false`, forced `false` when `NODE_ENV=production`. Off, every `/api/e2ee/*` route answers 404 before it reads the request |
| Scripted demo, run in CI | `scripts/e2ee-prototype-demo.sh`, `server/test/e2e/e2ee-demo.ts` | Starts its own server with the switch on |
| Test vectors | [`docs/encryption-test-vectors/mls-prototype.json`](encryption-test-vectors/mls-prototype.json) | |

### When the CI job runs

The `e2ee-prototype` job in `.github/workflows/ci.yml` is slow, so it runs
only when something it covers changes (the `e2ee` filter in
`.github/scripts/ci-changes.py`): `e2ee/**`, the `/api/e2ee` route, its
library files (`server/src/lib/e2ee*`, `mls-*`) and its schema and migration,
the E2EE tests, `packages/crypto*`, `docs/encryption-test-vectors/**`, the demo
script, the Android binding (`src/debug` and `src/testDebug` E2EE files and
`android/app/build.gradle.kts`, where the build flag lives) and the workflow
or detection scripts themselves. It also runs every night on `main`
(`schedule`), so dependency or toolchain drift shows up without a PR. When the
filter does not match, the job still starts and passes after one "No relevant
changes" step, like every other job in the workflow, so it never blocks an
unrelated PR that requires the check.

There is no per-phone toggle in the dashboard or the parent app, because there
is nothing a family can switch on yet. The recommendation's design is "no new
switch now": the future free-text toggle is per phone, off by default and
synced through `/rules`, and it is built after the review. The server switch
and the build flag are the prototype's only switches.

Storage is one additive migration, `server/drizzle/0058_e2ee_prototype.sql`
(six new tables, nothing changed). With the switch off they stay empty.

## Run it

```sh
# Core: 14 scenarios, the vectors, the error mapping (needs Rust 1.99)
(cd e2ee/mls-core && cargo test --locked --release)

# Demo: two parents, a child phone and a tablet against the real server
pnpm install && scripts/e2ee-prototype-demo.sh

# Delivery service routes
pnpm --filter @plainphone/server exec vitest run test/e2ee.test.ts

# Kotlin -> JNI -> Rust on the host JVM
(cd e2ee/mls-core && cargo build --locked --release --lib --features jni)
(cd android && ./gradlew --no-daemon testDebugUnitTest --tests 'org.plainphone.app.e2ee.*' \
  -PplainphoneMlsHostLib="$PWD/../e2ee/mls-core/target/release/libplainphone_mls.so")

# Debug APK with the arm64 library (needs the Android NDK)
e2ee/mls-core/scripts/build-android.sh
(cd android && ./gradlew --no-daemon assembleDebug -PplainphoneE2eePrototype=true)
```

The demo prints step names and counts, never texts, keys or sizes. It fails
(non-zero exit) on the first broken expectation.

## Design as built

- **Suite and group settings.** `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`
  (0x0001), `PURE_CIPHERTEXT` (commits and texts are both encrypted), padding
  64 bytes, `max_past_epochs` 0, OpenMLS's default sender ratchet (5 messages
  out of order, 1000 forward), ratchet tree in the Welcome
  (`e2ee/mls-core/src/client.rs`, `create_config`, `join_config`).
- **Identity.** The MLS credential is the opaque device ID, a random UUID the
  device picks before registering. The leaf signature key is bound to the
  household roster by a signature of the device's household-log key over
  `D("mls-leaf", {deviceId, mlsSignPub})` (`roster.rs`, `binding_input`,
  `verify_entry`; strict Ed25519 as in [encryption.md §2](encryption.md#2-keys-encoding-and-primitives)).
  In the full design this is a field of `device.add`/`phone.add`.
- **Checks in the core** (all in `client.rs`):
  - every key package added, every member of a Welcome, the Welcome's sender,
    every committer, every update-path leaf and every text sender must be on
    the roster with its bound key (`Roster::check_leaf`);
  - only `admin` devices (parents) add or remove; the child may rotate its own
    keys (`check_commit`, `join`);
  - commits may carry only add and remove proposals; standalone proposals and
    public (unencrypted) handshake messages are refused (`check_commit`,
    `process`);
  - after every merged commit the whole tree is checked again; a mismatch marks
    the conversation untrusted (`check_tree`);
  - a device refuses to send while the group holds a member the roster no
    longer lists (`encrypt`, error `stale_members`);
  - roster versions only move forward (`set_roster`, `roster_stale`);
  - duplicates are dropped before decryption (ciphertext hash) and after it
    (message ID inside the plaintext), so a retry is not mistaken for tampering;
  - a removed device deletes its group state at once (`Event::Removed`).
- **Delivery service** (`server/src/routes/e2ee.ts`):
  - parents (session) register `admin` devices, a child phone (device token)
    registers its `child` device; Self phones are not part of the prototype;
  - one commit per conversation and epoch, decided under a row lock; the loser
    gets 409, clears its pending commit, syncs and retries;
  - texts for any epoch other than the current one get 409;
  - the server reads only the clear MLS header (wire format, group ID, epoch,
    content type) and refuses commits and texts for another conversation;
  - adding or removing members needs an admin device (the server compares the
    declared member list with the current one);
  - each recipient has one total order (the delivery cursor); nothing is sent
    back to its sender. The cursor is a global sequence, so `fanOut` locks the
    recipients' device rows until its transaction ends: two deliveries to one
    device, even from different conversations, get cursors in the order they
    commit, and a fetch never skips a cursor that commits later;
  - a revoked device, or a device of a parent who left the household, gets
    nothing more, and what waited for a revoked device is deleted;
  - acknowledged deliveries are deleted, and a message is deleted when nobody
    still has to fetch it;
  - size limits: key package 4 KiB, commit and Welcome 64 KiB, text 8 KiB,
    text plaintext 2000 bytes (core), 50 key packages per device, 50 members;
  - no sender is stored for any message, and nothing is logged about content,
    keys or sizes.
- **Bindings.** The core exposes `call(bytes) -> bytes` with JSON requests
  (`api.rs`). The JNI layer (`jni.rs`) is the crate's only unsafe code: it
  copies bytes in and out and zeroes its buffers. Panics are caught and become
  `{"ok":false,"error":"panic"}`. Errors carry a code and a fixed sentence;
  OpenMLS errors are reduced to their variant names (`error.rs`, `mls`).
- **Why JNI and not UniFFI.** The recommendation says "generate bindings with
  UniFFI". The prototype deviates on purpose for the phone: the whole API is
  one function that takes and returns bytes, so the hand-written JNI shim
  (`jni.rs`, about 50 lines) can be read in full, and `jni-sys` (no
  dependencies, no build script) is the only new crate. UniFFI would add its
  runtime and code generator to the supply chain, generated Kotlin to review,
  and JNA as an Android dependency, without removing the unsafe code that
  matters here. The JSON layer in `api.rs` is the same either way. UniFFI
  stays the plan for Expo (uniffi-bindgen-react-native, gap 3), where it
  generates the TurboModule glue that a single JNI function does not cover;
  the reviewer should decide whether the phone then uses it too.

## Threat model

The model is the one in [encryption.md §1](encryption.md#1-threat-model)
narrowed to family texts.

**Assets.** Text content, who wrote it, and which devices can read a
conversation.

**Adversaries.**

1. *A malicious or compromised server* that reads everything it stores,
   substitutes key packages, adds its own device, withholds, delays, reorders,
   duplicates or replays messages, forks a conversation, or keeps delivering to
   a removed device.
2. *A stolen or revoked device* that keeps its old state and tries to read
   texts after its removal, or a restored (rolled-back) copy of a device.
3. *A household member's device beyond its role*: the child phone trying to add
   or remove members, or a device presenting a key the roster does not list.

**Trusted.** The household roster each device accepts (in the full design: the
verified household log), the device's own platform and storage, TLS to the
server.

| Threat | What the prototype does | Evidence |
|---|---|---|
| Server reads texts | Only ciphertext reaches it; padding to 64 bytes | `e2ee-demo.ts` step 10; `padding_hides_length_within_64_byte_steps` |
| Server substitutes a key package or adds its own device | Refused by the adder and by every joiner | `substituted_key_package_is_refused`, `joiner_refuses_a_welcome_with_an_unlisted_member`, `forged_binding_and_roster_rollback_are_refused` |
| A sender with a key the roster no longer lists (re-enrolled device) | Its texts are refused | `a_sender_whose_key_the_roster_no_longer_lists_is_refused` |
| Removed device keeps reading | One removal commit; the removed device deletes its state; later texts are unreadable even when forwarded | `add_then_remove_a_member`; demo step 7 |
| Server withholds the removal (stale roster) | Senders refuse while the roster lists fewer members than the group; the server refuses texts for an old epoch | `add_then_remove_a_member` (`stale_members`); `accepts one commit per epoch …` in `server/test/e2ee.test.ts`; demo steps 7 and 9 |
| Concurrent commits fork the group | One accepted commit per epoch, 409 for the other | `concurrent_commits_resolve_to_one`; demo step 9 |
| Child adds or removes members | Refused by its own core (if its roster is honest), by every receiver, and by the server | `receivers_refuse_an_add_by_the_child`; server test above |
| Replays and sender retries | Dropped before decryption | `duplicates_and_retries_are_dropped_before_decryption` |
| Late text from an old epoch | Refused (`max_past_epochs` 0) | `key_rotation_by_the_child_and_forward_secrecy_across_epochs` |

**Residual risks a reviewer has to judge.**

- A server can still *delay* a removal for devices that have not learned of
  it from the roster, and it can split devices into partitions. MLS detects a
  fork only when the halves meet. The roster check closes the gap only once
  the sender's roster is current, which in the full design depends on the log
  head and its out-of-band comparison ([encryption.md §3](encryption.md#3-membership-and-freshness)).
- A stolen device that still holds the current epoch reads everything until
  the removal commit is merged. That is the window between "phone lost" and a
  parent's removal.
- The server sees metadata: conversation and household, which devices are
  members, epochs, content type, padded size, timestamps and each device's
  fetch times. It does not see who sent a text.

## Not covered, and known gaps

Each of these is a reason the prototype is not a product.

1. **No household log.** The app hands the core a roster it trusts, and the
   core verifies the binding signatures, but the log's hash chain, permissions
   and freshness ([encryption.md §3](encryption.md#3-membership-and-freshness))
   are not implemented. The demo plays the log with synthetic Ed25519 keys.
   "Refuse to send while the accepted log head is behind the server's" exists
   only as roster versions and the server's epoch check.
2. **State at rest is not encrypted.** `export_state` returns the MLS store
   with private keys in clear. A real integration needs Android Keystore
   AES-GCM (and SecureStore on Expo), exclusion from Auto Backup and iCloud,
   and "restore = re-enrollment". Measured in the research: a rolled-back
   copy loses texts and then gets stuck.
3. **Only the Android phone has a binding**, and it has run only on the host
   JVM, not on a device or emulator. There is no Expo/React Native module (the
   recommendation's path is uniffi-bindgen-react-native and a development
   build), no iOS, and no browser build: browser decryption waits, as the
   recommendation and [family-comms](research/family-comms.md#family-inbox) say.
   The arm64 `.so` is built in CI but has never been loaded on a phone.
   **The parent app is one of the clients the recommendation names, and the
   prototype does not deliver it:** in the demo the parents are the `pp-mls`
   CLI, which runs the same core and `call` API that an app binding would.
   The plan for the parent-app client, as a follow-up issue under #120:
   (a) a local Expo module in `parent-app/modules/` that exposes `call`
   through uniffi-bindgen-react-native, built for arm64 Android and iOS;
   (b) a development build only, never in a store build, behind the same
   kind of build flag as the phone; (c) state at rest in SecureStore-wrapped
   storage, excluded from backup (gap 2); (d) the shared `selftest` op and the
   demo's scenarios run on a physical iPhone and an Android parent phone (the
   recommendation's real-device gate).
4. **No push.** Clients poll `/api/e2ee/inbox`. The real path must keep push
   payloads generic (a conversation handle and a cursor at most).
5. **No retention sweeper.** Deliveries are deleted on acknowledgement; a
   device that never fetches keeps its queue. Key packages have no server-side
   expiry, and the last-resort package is reused without limit.
6. **The server cannot check that a commit matches the member list it is
   given.** A dishonest admin device can declare the wrong list. That only
   affects who gets ciphertext; the clients check the real MLS tree.
7. **No rate limits** on the prototype routes, beyond the body and count limits.
8. **One process-wide lock** around all clients in the core (`api.rs`,
   `registry`), and OpenMLS's in-memory store keeps secrets in ordinary heap
   memory without zeroisation.
9. **Self phones, emergency and trusted devices** are not part of the
   prototype; roles are `admin` (parent) and `child`.
10. **Licences.** The crate set is the research harness's OpenMLS tree plus
    `jni-sys` 0.3.0 (MIT or Apache-2.0, no dependencies, no build script) and
    `serde_json`, `base64ct`, `sha2`, `ed25519-dalek` and `zeroize`, which were
    already in the tree. hpke-rs is MPL-2.0. Nothing ships in a release build,
    so `NOTICE` is unchanged; the NOTICE audit belongs to the first build that
    ships the library.
11. **Sizes.** The arm64 library is about 2.45 MB (1.04 MB gzip), a little more
    than the research harness's 2.2 MB because of the JSON layer.

## For the reviewer

Start with the checklist in the
[recommendation](research/e2ee-recommendation.md#checklist-for-the-independent-review),
which now points at the files, functions and tests for each item. The fastest
way in is `e2ee/mls-core/src/client.rs` (all checks), then
`server/src/routes/e2ee.ts` (ordering), then `server/test/e2e/e2ee-demo.ts`
(the whole flow).
