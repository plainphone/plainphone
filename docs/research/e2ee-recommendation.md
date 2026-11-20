# Endpoint encryption for family messages: OpenMLS or a Matrix SDK

Status: **recommendation for independent review** (issue #120, part of the
[family communication research](family-comms.md), draft 3 in the
[issue drafts](family-comms-issues.md#3-verify-an-endpoint-encryption-design-for-plainphone-messages)).
Nothing here selects or ships an implementation. Free text on a family device
stays off until an independent security and privacy review has recorded an
outcome (see the [checklist](#checklist-for-the-independent-review)).

## Outcome

**Recommendation:** build private caregiver text on **OpenMLS** (MLS, RFC 9420),
with the Plainphone API as the delivery service and the household log from the
[encryption specification](../encryption.md#3-membership-and-freshness) as the
only source of device identity. Keep **matrix-sdk-crypto** as the fallback if
the review rejects the OpenMLS integration cost. Both pass every scenario the
issue asks for in synthetic tests, but only after Plainphone adds the same
checks around them. The differences that decide it:

- **Revocation.** In MLS one removal commit cuts a revoked device off for every
  sender. In Matrix every sender has its own Megolm session, so each one must
  notice the removal and rotate. A sender that does not rotate keeps leaking
  to the revoked device (measured).
- **Metadata.** MLS pads texts (64-byte steps in the test) and hides the
  sender inside the ciphertext. Megolm reveals each text's length to 16 bytes,
  the sender device and who shares keys with whom (measured).
- **Forward secrecy.** An MLS receiver refuses texts that are far behind its
  ratchet. An inbound Megolm session can still decrypt every earlier message
  of that session (measured).
- **Fit.** MLS needs exactly one thing from the server that Plainphone already
  has: an authenticated API that can accept one commit per epoch and keep one
  order per conversation. Matrix brings its own user, device, cross-signing
  and key-backup model, which would duplicate the household log.
- **Size.** The OpenMLS library is 2.2 MB on Android arm64. vodozemac alone is
  0.9 MB, but the SDK that adds rotation and device tracking is 4.6 MB
  (measured, see [sizes](#sizes)).

Matrix is ahead on mobile and browser packaging (official Kotlin, Swift and
WebAssembly packages used by Element). It also needs no commit ordering, and
it has encrypted state at rest and an optional history backup out of the box.
OpenMLS has no official Kotlin, Swift or React Native bindings, so Plainphone
would own a thin binding layer. That is the main cost and the main risk.

## What was measured and what was read

**Measured** on Linux x86_64 on 2026-11-20 with Rust 1.99.1 and Node 24, using
the harnesses in [`research/e2ee`](../../research/e2ee/README.md):

- OpenMLS 0.9.2 with openmls_rust_crypto 0.6.0, 10 scenarios.
- vodozemac 0.11.2 (Olm + Megolm), used the way matrix-sdk-crypto uses it,
  with the same 10 scenarios.
- matrix-sdk-crypto 0.19.1 `OlmMachine` (in-memory store) through its public
  API against an in-process homeserver, 5 scenarios about the SDK's own
  defaults.
- OpenMLS built natively and as wasm32 (wasm-bindgen) and run in Node: each
  runtime creates a group that the other joins, reads and answers.
- Release builds of all three for Android arm64 (NDK r27, API 29) and wasm32,
  with a C-ABI self-test that passes on the host.

The full output of the last run is in
[results.txt](../../research/e2ee/results.txt). All users, devices and texts
are synthetic, and the servers are in-process fakes.

**Not measured:** anything on a physical Android phone or iPhone, in a
browser, in the Expo app or behind Kotlin/Swift bindings. Also not measured:
persistent stores (OpenMLS SQLite, matrix-sdk SQLite/IndexedDB), performance
on low-end phones, and push wake-ups. The Android `.so` files were built and
sized but never loaded on a device.

**Read, not measured:** audits, maintenance, binding packages and Hermes
support. Sources are linked where they are used.

## Results for the issue's test list

"Plainphone check" means a check in the harness that a real integration must
also implement. Neither library does it on its own.

| Test | OpenMLS | Matrix (vodozemac model and SDK probe) |
|---|---|---|
| Cross-platform encrypt/decrypt | 4 devices read each other. Native ⇄ wasm32-in-Node in both directions: create, join from the Welcome, read and answer | 4 devices read each other (both harnesses). Not run across runtimes |
| Substituted endpoint | OpenMLS admits a server-made key package with the child's label, and the server reads the text. A roster check refuses the add, and a joiner refuses a Welcome with an unknown member (Plainphone check) | With keys from the server, the sender shares the room key with the server-held key, which reads the text. A roster check refuses it and also refuses forged room keys (Plainphone check). The SDK ignores another user's keys listed under the child, but shares with a new device the operator registers on the child's own account under the default `AllDevices`. With `OnlyTrustedDevices` and exactly the household-log devices marked verified, it does not share |
| Stale roster | A server that withholds the removal from parent B makes B send in the old epoch. A stolen copy of the revoked tablet reads that text. A server-side epoch check (409) stops the stale send, and the client must also refuse to send while its log head is behind | A sender that trusts a stale server member list keeps sharing with the revoked tablet, which reads the text. Taking recipients from the household log fixes it. A server that withholds log entries can delay both designs |
| Revoke then send | One removal commit: B and the child read, the tablet reads nothing and can no longer send | The SDK rotates after a device is deleted from the server's list. In the vodozemac model, a sender that does not rotate leaks to the tablet. The revoked tablet can still encrypt with its old session, and the child accepts that unless the app checks the sender against the log |
| Lost device | Remove + add in one commit. The re-enrolled phone reads new texts and none of the old ones | Same by default. If a parent forwards the old Megolm session (or a key backup restores it), the new phone also reads history. That needs a policy decision |
| Retry and reordering | 5/5 texts read in shuffled order. A duplicate ciphertext fails (`SecretReuseError`). A sender retry re-encrypts, so the app needs a message id inside the plaintext. A text 11 generations behind fails with tolerance 5 | 5/5 read in shuffled order. vodozemac decrypts a duplicate again, and the SDK accepts the same ciphertext under a new event id, so the app must dedupe by session and index. Old indices always decrypt |
| Concurrent changes | Without ordering, two commits in one epoch fork the group and A and B can no longer read each other. With one accepted commit per epoch (409, clear, sync, retry) all members agree | Nothing to order: parallel rotations converge |
| Offline catch-up | Child offline across 3 commits and 4 texts reads all 4 in server order. If delivery puts a commit before an older text, 0 of 1 is read. `max_past_epochs = 1` recovers it at a forward-secrecy cost | Reads all 4. A text that arrives before its room key (separate queues) is "unable to decrypt" until a retry after the key arrives |
| Local storage | Store of 10 KB for a 4-member group, containing the raw Ed25519 private key in clear. A restart from it works. A rolled-back copy loses a text, then is stuck after the next commit | Encrypted pickles of 8 KB. A restart works. A rolled-back copy reuses a Megolm index: the first AES-CBC block is identical for texts with the same first 16 bytes, which leaks plaintext equality. The receiver rejects the second text as a replay |
| Ciphertext-only server and push | 43 server-visible blobs, no plaintext. The clear header shows group id, epoch and content type. Sizes 190/254 bytes for 15–100-byte texts. The device label is visible only in the published key package | 18 blobs (model) and 12 (SDK), no plaintext. Sizes 93–189 bytes follow text length. The server sees sender device, session id, message index and the key-sharing graph |

Push payloads in both harnesses carry only a conversation handle and a cursor.
That is a design choice of the fake server, which the real push path must
keep.

## Comparison

| | OpenMLS 0.9.2 | Matrix: vodozemac 0.11.2 + matrix-sdk-crypto 0.19.1 |
|---|---|---|
| Protocol | IETF RFC 9420 group key agreement with one shared epoch | Olm (pairwise Double Ratchet) carrying per-sender Megolm group keys. Matrix spec, no IETF standard |
| Security review | SRLabs audit sponsored by the Sovereign Tech Agency: 8 findings, 1 High (improper MAC authentication), fixed in 0.7.3/0.8.1 apart from one Low ([OpenMLS blog, 25 Aug 2026](https://blog.openmls.tech/)). Earlier advisories include GHSA-8x3w-qj7j-gqhf. Read | vodozemac audited by Least Authority in 2022 ([report](https://leastauthority.com/static/publications/LeastAuthority-Matrix_vodozemac_Final_Audit_Report.pdf)). Reported issues analysed by Matrix in Feb 2026, with no practical exploit acknowledged ([Matrix](https://matrix.org/blog/2026/02/analysis-of-reported-issues-in-vodozemac/)). Read |
| Revocation | One commit by any member. Measured | Each sender rotates its own session. The SDK does this when the server's device list changes. Measured |
| Forward secrecy inside a conversation | Per message, within the reordering tolerance | Only across rotations: the SDK default rotates after a week or 100 messages (read in code) |
| Post-compromise security | Every commit or update heals | Only a new Olm/Megolm session heals |
| Offline ordering | Needs one total order per conversation and one commit per epoch from the server | Tolerant. Room keys and timeline arrive separately, so "unable to decrypt yet" must be handled |
| Device identity binding | `BasicCredential` is a label. Plainphone binds the leaf signature key to the household log | Curve25519/Ed25519 device keys, signed and carrying user and device IDs. Cross-signing would duplicate the log. Bind with `OnlyTrustedDevices` and local trust from the log |
| Recovery | Visible re-enrollment and re-add. No history | Re-enrollment. Optional history through key forwarding or server-side key backup, which needs a policy decision |
| Local storage | Pluggable `StorageProvider`. The memory store keeps keys in clear. A SQLite provider exists (not tested). App-level encryption is needed | Pickles encrypted with an app key. The SDK has SQLite and IndexedDB stores with a store cipher (not tested) |
| Server metadata | Group id, epoch, content type, padded size, routing. Commits and Welcomes are encrypted (PURE_CIPHERTEXT), and key packages show the credential | Sender device, session id, message index, unpadded size, every key share |
| Kotlin (phone, Android parent app) | No official binding. Needs a UniFFI or JNI wrapper around one Rust crate. The `.so` builds for arm64 | Official Kotlin components used by Element X Android (`matrix-rust-components-kotlin`, latest release 17 Nov 2026; read). That package wraps the full client SDK, not only crypto |
| Expo / React Native (iOS + Android) | No binding. Path: Rust core plus a native module, e.g. Mozilla's [uniffi-bindgen-react-native](https://hacks.mozilla.org/2024/12/introducing-uniffi-for-react-native-rust-powered-turbo-modules/) (MPL-2.0 generator). Needs a custom dev build, which the app already uses | No official React Native package. The same native-module path applies. The wasm package needs WebAssembly in Hermes, which is unconfirmed (only a podcast mention, no Hermes documentation found) |
| Browser | Builds for wasm32 with the `js` feature (not WASI). It ran in Node through wasm-bindgen (measured). Key storage in IndexedDB is not designed | Official `@matrix-org/matrix-sdk-crypto-wasm` 19.0.1 (Apache-2.0, 9.1 MB unpacked, used by Element Web; read) with an IndexedDB store |
| Size, Android arm64 `.so` | 2.2 MB (0.97 MB gzip) | vodozemac 0.89 MB. matrix-sdk-crypto 4.6 MB (1.7 MB gzip), without a persistent store |
| Dependencies (host build) | 148 crates, 23 with build scripts | vodozemac 77 crates. matrix-sdk-crypto 205 crates, 22 with build scripts |
| Licence | MIT. Transitive hpke-rs is MPL-2.0 (file-level copyleft) | Apache-2.0. Transitive MPL-2.0/MPL-2.0+ (as_variant, eyeball, eyeball-im, imbl, readlock), Unicode-3.0 and Zlib |
| Maintenance | openmls/openmls (Cryspen and Phoenix R&D), 0.9.2 released Oct 2026, commits this week (read) | matrix-org/matrix-rust-sdk, element-hq products depend on it, commits this week (read) |
| Server side | Plainphone Hono API plus key-package and ordered-queue endpoints | A homeserver (Synapse is AGPL; Conduit lineage is Apache-2.0), or reimplementing its keys and to-device APIs in Hono |

### Sizes

Release builds with `opt-level = "s"`, LTO and stripping. Each library includes
a small self-test so the whole path is kept. Measured with
[`scripts/sizes.sh`](../../research/e2ee/scripts/sizes.sh).

| Library | Android arm64 `.so` | gzip | wasm32 | gzip |
|---|---|---|---|---|
| OpenMLS harness | 2,219,816 | 970,926 | 2,143,090 | 617,807 |
| vodozemac harness | 889,616 | 440,380 | 543,255 | 204,319 |
| matrix-sdk-crypto probe | 4,553,288 | 1,726,684 | 3,271,868 | 930,061 |

The APK carries one `.so` per ABI it ships. The phone app has no native
libraries and no ABI filter today, so the build would need an ABI decision.
For arm64 alone, the OpenMLS cost is about 1 MB compressed.

## Licences

Everything that would be linked into the app is permissive or file-level
copyleft. Nothing is AGPL. OpenMLS is MIT, and vodozemac and
matrix-sdk-crypto are Apache-2.0. Both trees contain MPL-2.0 crates (hpke-rs on
the OpenMLS side; as_variant, eyeball, eyeball-im, imbl and readlock on the
Matrix side). MPL-2.0 is compatible with distribution in an Apache-2.0 app, but
modified MPL files must stay available as source, and the notice file must list
them. Unicode-3.0 and Zlib (Matrix side) need notices. Synapse, Element Call
and libsignal are AGPL and are not used. The NOTICE audit belongs to the
implementation PR, after the final crate set is known.

## Concrete interoperability gaps

1. **No OpenMLS bindings for Kotlin, Swift or Expo.** Plainphone would own one
   Rust crate with a narrow API (create, join, add/remove by log entry, encrypt,
   decrypt, export state) and generate bindings with UniFFI. For Expo this
   means a native module and a development build. Unmeasured on devices.
2. **Browser build needs the `js` feature.** OpenMLS refuses wasm32 without
   `js` (wasm-bindgen randomness and time), and so does getrandom 0.2, used
   by the RustCrypto ECDSA crates. Measured. A browser inbox also needs a
   storage design: the [spec](../encryption.md#6-library-choices-and-verification)
   keeps keys non-exportable in IndexedDB, but MLS state is a mutable blob that
   must be encrypted under such a key.
3. **Device identity binding.** The household log lists `signPub` (Ed25519)
   and `kemPub` per device. The MLS leaf needs its own signature key: add an
   `mlsSignPub` to `device.add`/`phone.add`, signed by the existing key, and
   reject every key package and Welcome member that does not match. Matrix
   would need the same mapping onto its device keys plus `OnlyTrustedDevices`.
4. **Ciphersuite.** RFC 9420 has no X25519 + AES-256-GCM suite. Suite 0x0001
   (AES-128-GCM, tested) or 0x0003 (ChaCha20-Poly1305, supported by
   openmls_rust_crypto, not tested) differs from the spec's AES-256-GCM.
5. **Server ordering.** The API must accept at most one commit per epoch and
   conversation (409 otherwise), refuse texts for an older epoch, deliver one
   total order per recipient, and publish and claim key packages, including a
   last-resort package for the child phone.
6. **Two crypto stacks on the phone.** The phone already uses Tink on the JVM
   for F1. An MLS core adds a Rust crypto stack (RustCrypto and libcrux). Both
   need the same Keystore wrapping and backup exclusion.
7. **State must not roll back.** Neither library tolerates a restored
   snapshot. Exclude conversation state from Android Auto Backup and iCloud,
   and treat restore as re-enrollment. Measured for both.
8. **App-level dedupe and message ids.** Both need a client message id inside
   the plaintext. Matrix also needs (session, index) replay checks, and MLS a
   dedupe step before decrypting so a duplicate is not reported as tampering.
9. **Matrix model mismatch, if the fallback is chosen.** Matrix user IDs and a
   homeserver account per person do not exist in Plainphone. Cross-signing,
   verification and key backup would have to be disabled or mapped onto the
   log. The SDK default `AllDevices` must be overridden.

## Recommended design (for review)

- One MLS group per family conversation. The group ID is random, members are
  log devices, and the credential is the opaque device ID from the log.
  Suite 0x0001 or 0x0003, `PURE_CIPHERTEXT`, `padding_size` 64 or larger,
  `max_past_epochs` 0, default sender ratchet.
- The Hono API is the delivery service. It stores ciphertext, recipient
  device IDs, epoch, timestamps and bounded delivery state, orders commits
  (409), and sends generic push payloads only.
- Any admin device in the conversation commits log changes: a log removal
  becomes an MLS removal. The child phone does not add members.
- Clients refuse to send while their accepted log head is behind the head the
  server reports. They check every add, Welcome and commit against the log,
  and show the participant devices to the child (design principle 1).
- State lives in the app's encrypted store (Android Keystore AES-GCM,
  SecureStore-wrapped key) and is excluded from OS backups. A lost device is a
  visible re-enrollment with no history.
- Browser decryption waits, as [family-comms](family-comms.md#family-inbox)
  already says. The web dashboard keeps managing settings without reading text.
- No new switch now. The future free-text toggle is per phone, off by default
  and synced through `/rules`, and it is only built after the review.

Rough size of the implementation (unverified): 3–5 days for the Rust core and
bindings on Android and Expo, 2–3 for API ordering and key-package endpoints,
2–3 for log binding and device UI, 2–3 for real-device tests. That is on top of
#121's UI work.

## Checklist for the independent review

The reviewer should record an outcome (approve, approve with changes, reject)
for each item before free text is enabled:

- [ ] Threat model: a malicious or compromised server that withholds, reorders
      or forks, combined with a stolen device that keeps old state. Is the
      residual stale-epoch exposure acceptable?
- [ ] Binding of MLS leaf keys to the household log (`mlsSignPub` design,
      domain separation from the log's Ed25519 key, key-package validation on
      add and on join).
- [ ] Ciphersuite choice versus the spec's AES-256-GCM.
- [ ] Server ordering rules (one commit per epoch, stale-epoch refusal) and
      what clients do on 409 and on forks.
- [ ] `max_past_epochs` and sender-ratchet tolerance versus forward secrecy.
- [ ] Local storage: encryption at rest, backup exclusion, rollback handling,
      deletion on removal.
- [ ] Recovery: no history after loss, and how this is explained to families.
- [ ] Metadata: padding size, clear header fields, key-package exposure,
      push payloads, retention.
- [ ] Binding layer review (UniFFI or JNI, Expo native module, wasm-bindgen if
      a browser inbox follows): panics, error mapping, zeroisation.
- [ ] Licences and NOTICE for the exact crate set (MIT, Apache-2.0, MPL-2.0,
      BSD-3-Clause, Unicode-3.0).
- [ ] Upstream status: OpenMLS audit fixes present in the pinned version, and
      advisories since.
- [ ] Real-device gate: Android 10 phone, physical iPhone and Android parent
      phones on custom Expo builds, each running the shared self-test and
      the scenario set from this report.
- [ ] If the review rejects OpenMLS: the same list for matrix-sdk-crypto with
      `OnlyTrustedDevices`, log-driven local trust and key backup off.

## Evidence

The family-communication research motivates clear boundaries for who can read
family messages, including when devices change
([joint oversight study](https://doi.org/10.1145/3512904)). The technical
evidence for this recommendation is the harness output above.

## Process note

During the experiment, pin-project-lite 0.2.18 (published one day earlier) was
compiled into the wasm32 build through js-sys and futures-util. The first age
check only covered the host graph. `audit_deps.py` now checks every lockfile
entry for all targets. Every crate younger than three days was pinned back
(pin-project-lite, regex, regex-automata, regex-syntax, smallvec, cc), and the
wasm build and cross-runtime check were rebuilt from scratch on the older
versions. pin-project-lite is a macro-only crate without a build script.
