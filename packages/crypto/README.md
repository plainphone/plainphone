# Plainphone crypto core

This workspace library implements the F1 wire cryptography in the
[encryption specification](../../docs/encryption.md). Its JVM counterpart is
`org.plainphone.app.sync.crypto` in the Android app.

Build with `pnpm --filter @plainphone/crypto build`. Instantiate `CryptoCore`
with independently selected HPKE and Ed25519 signing backends. The default is
native WebCrypto. Pass `"noble"` for X25519 or Ed25519 signing when the native
operation is unavailable. Both signing paths use the common strict verifier.
The library uses standard WebCrypto, UTF-8 `TextEncoder` and `TextDecoder`,
and well-formed Unicode string checks. An Expo consumer must provide these
globals before importing the library and use a native WebCrypto provider
in its custom build. F1 runs the shared vectors on Node and the JVM. At the
start of F2, run the device gate in the encryption specification: Tink
X25519 HPKE and Ed25519 signing and verification on physical Android 10,
Ed25519 fallback signing and verification at the browser support floor
without native Ed25519, and crypto smoke tests on physical iOS and Android
with custom Expo builds.

Use the canonical decoder for padded plaintext. Treat incoming wire headers
as untrusted. Resolve the authorized signer and expected context from
accepted local state before calling `openEnvelope` or `openRecord`. For
H/R/L envelopes supply the locally accepted scope commitment. For per-change
envelopes bind the change context and check its trusted approval separately.
`verifyLog` authenticates the bytes and immediate chain link. The roster
consumer is responsible for trusting genesis and authorizing and applying each
transition. In Kotlin, `verifyLog`, `verifyObject`, `openRecord` and
`openEnvelope` reject malformed wire data or failed authentication with
`IllegalArgumentException`. The `verify` and `hmacVerify` predicates return
false for invalid signatures and tags. Populate each device's Self grants
from the accepted roster, including the grant to the device that signs Self
phone creation. Use `hasSelfScope` with that device's grants.

After authenticating the rules record, call `rulesRejection` with its
`rules-digest` and the last accepted revision and digest for that phone
(or null before the first revision). The header must use wire
version 1 and its record ID must equal its phone ID. Equal revisions
require equal digests.

Use `hmacVerify(key, input, tag)` with the decoded 32-byte tag for enrollment
and pairing MACs. The helper uses WebCrypto verification in TypeScript and
a constant-time byte comparison in Kotlin.

The callers own durable nonce budgets, replay state, epoch and revision
tracking, device enrollment, storage and key lifecycle. F1 has no app or sync
call sites.

Run the shared JSON fixtures in `pnpm -r test` and in Android's
`./gradlew --no-daemon testDebugUnitTest`. See the
[fixture guide](../../docs/encryption-test-vectors/README.md) for coverage.
