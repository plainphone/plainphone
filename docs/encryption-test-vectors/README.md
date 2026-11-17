# Plainphone v1 test vectors

These are public deterministic fixtures for the [encryption specification](../encryption.md).
Never use their keys, seeds, nonces or ephemeral inputs outside tests.

Run from the repository root with Node 24 and the pinned pnpm version.

```sh
pnpm --filter @plainphone/crypto-vectors test
pnpm --filter @plainphone/crypto test
(cd android && ./gradlew --no-daemon testDebugUnitTest)
pnpm --filter @plainphone/crypto-vectors generate
```

The generator test compares the checked-in JSON with recomputed bytes. The
TypeScript and Kotlin crypto tests read both JSON files directly and exercise
known answers and negative cases. Both test suites run in CI. Use
`generate` only for deliberate changes to fixtures, then review the JSON diff.

- `primitives.json` gives JCS bytes, SHA-256, RFC 4231 HMAC test 1, RFC 5869 HKDF test 1, RFC 8032 Ed25519 test 1,
  AES-256-GCM, strict Ed25519 and encoding rejection cases, and the [RFC 9180 authors' vectors](https://github.com/cfrg/draft-irtf-cfrg-hpke/blob/master/test-vectors.json)
  for mode 0, KEM 32, KDF 1 and AEAD 2 (sequence 0). The RFC HPKE example
  uses nonempty AAD to exercise the primitive. Tink's hybrid API uses
  empty AAD, so use the protocol envelope for its HPKE check.
- `protocol.json` gives the signed membership log with head hashes, including
  removal with ordered H/L/R epoch commitments and explicit rotation. It also
  gives signed HPKE envelopes, a signed encrypted rule snapshot, all four
  signed commands, a phone-signed R position report and R release acknowledgement,
  an H blob with a null phone ID, the 252/253-byte padding boundary, and
  admission fingerprints that bind the candidate's user ID, and a Find response
  wrapped to the emergency requester. The Self change
  includes the base and resulting signed snapshots, the encrypted operation
  and its phone and trusted-device HPKE envelopes at R epoch 2, and a trusted
  approval.
  Rejection cases include same-user-ID access from a separate principal, a
  low-order HPKE encapsulation, a fork, stale
  revision, wrong scope or role, wrong Self base, retired epoch and replay. The file also covers enrollment and pairing MACs, a nonzero paper
  recovery code and its derived keys, dedupe derivation and the DNS HPKE copy.
  The rule and Self operation bodies are illustrative at F0.

All byte strings are unpadded base64url, including empty bytes (`""`). Numeric
values are JSON integers. `signInput` is the exact pre-signature byte string.
`encryption.plaintext` includes the four-byte length and zero padding.
`hpke.ikm` and `hpke.ikmE` generate deterministic test key pairs through
DHKEM DeriveKeyPair. To decrypt without re-deriving the pair, use
`recipientPublicKey` and `recipientPrivateKey`. For Tink NO_PREFIX, join
decoded `enc || ct` and pass decoded `info` as context_info. For AES-GCM,
join decoded `nonce || ct` and pass decoded `aad`. Use strict profile Ed25519
verification with `signing.publicKey` for admin signatures,
`selfChange.approval.signPub` for trusted approval, and the phone signing key
from the phone-add post for the report, Find result and release acknowledgement.
Use the emergency key from its device-add post to verify the emergency Find
command and to test rejection of a rules snapshot signed by that device. Use the decoded
signature and decoded `signInput`. F1 tests must additionally derive the signed and AAD
bytes from structured fields, assert equality with these fixtures and check
rejections when the context, authorization or ciphertext changes. JVM CI
consuming both files is a required F1 gate.

The S+L case targets scalar-reducing verifiers (ZIP-215 itself also rejects
S ≥ L). The zero-x sign-bit case necessarily encodes a small-order point.
Its challenge uses the original bytes, as required in ZIP-215. The canonical
identity-R case isolates the small-order check with a valid non-cofactored
equation. The identity-A/R case exercises the zero-scalar edge case.

For the emergency Find integration test in F3, use the signed on-request
policy from the fixture. Deliver four fresh, distinct request UUIDs from one
emergency device within an hour. Assert four captures, the persistent
indicator and one encrypted admin notice. Replay a UUID and deliver a fifth
fresh UUID, then repeat after restarting the process and rebooting without
an anchor. Assert no extra capture or notification. A second emergency
device has an independent budget. After an hour of credited elapsed time,
check that the indicator clears and the original device can request again.
Check that Ring and “Are you okay?” still work without an anchor after
reboot, with visible freshness marking, and that release and Self loosening
remain blocked.
