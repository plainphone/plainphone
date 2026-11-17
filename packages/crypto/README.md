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
in its custom build. The encryption specification also calls for browser
and Expo tests on real devices.

Use the canonical decoder for padded plaintext. Treat incoming wire headers
as untrusted. Resolve the authorized signer and expected context from
accepted local state before calling `openEnvelope` or `openRecord`. For
H/R/L envelopes supply the locally accepted scope commitment. For per-change
envelopes bind the change context and check its trusted approval separately.
`verifyLog` authenticates the bytes and immediate chain link. The roster
consumer is responsible for trusting genesis and authorizing and applying each
transition. Populate each device's Self grants from the accepted roster,
including the grant to the device that signs Self phone creation. Use
`hasSelfScope` with that device's grants.

After authenticating the rules record, call `rulesRejection` with its
`rules-digest` and the last accepted revision and digest for that phone
(or null before the first revision). Equal revisions require equal digests.

The callers own durable nonce budgets, replay state, epoch and revision
tracking, device enrollment, storage and key lifecycle. F1 has no app or sync
call sites.

Run the shared JSON fixtures in `pnpm -r test` and in Android's
`./gradlew --no-daemon testDebugUnitTest`. See the
[fixture guide](../../docs/encryption-test-vectors/README.md) for coverage.
