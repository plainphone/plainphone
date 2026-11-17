# Plainphone v1 test vectors

These are public deterministic fixtures for the [encryption specification](../encryption.md).
Never use their keys, seeds, nonces or ephemeral inputs outside tests.

Run from the repository root with Node 24 and the pinned pnpm version.

```sh
pnpm --filter @plainphone/crypto-vectors test
pnpm --filter @plainphone/crypto-vectors generate
```

The test compares the checked-in JSON with recomputed bytes and checks known
answers and negative cases. The recursive test target runs it in CI. Use
`generate` only for deliberate changes to fixtures, then review the JSON diff.

- `primitives.json` gives JCS bytes, SHA-256, RFC 4231 HMAC test 1, RFC 5869 HKDF test 1, RFC 8032 Ed25519 test 1,
  AES-256-GCM, and the [RFC 9180 authors' vectors](https://github.com/cfrg/draft-irtf-cfrg-hpke/blob/master/test-vectors.json)
  for mode 0, KEM 32, KDF 1 and AEAD 2 (sequence 0). The RFC HPKE example
  uses nonempty AAD to exercise the primitive. Tink's hybrid API uses
  empty AAD, so use the protocol envelope for its HPKE check.
- `protocol.json` gives the signed membership log with head hashes, including
  removal with ordered H/L/R epoch commitments and explicit rotation. It also
  gives signed HPKE envelopes, a signed encrypted rule snapshot, all four
  signed commands and a phone-signed release acknowledgement. The Self change
  includes the encrypted operation, its per-change HPKE envelope and a trusted
  approval. The file also covers enrollment and pairing MACs, a nonzero paper
  recovery code and its derived keys, dedupe derivation and the DNS HPKE copy.
  The rule and Self operation bodies are illustrative at F0.

All byte strings are unpadded base64url, including empty bytes (`""`). Numeric
values are JSON integers. `signInput` is the exact pre-signature byte string.
`encryption.plaintext` includes the four-byte length and zero padding.
`hpke.ikm` and `hpke.ikmE` generate deterministic test key pairs through
DHKEM DeriveKeyPair. To decrypt without re-deriving the pair, use
`recipientPublicKey` and `recipientPrivateKey`. For Tink NO_PREFIX, join
decoded `enc || ct` and pass decoded `info` as context_info. For AES-GCM,
join decoded `nonce || ct` and pass decoded `aad`. Use plain Ed25519
verification with `signing.publicKey` for admin signatures,
`selfChange.approval.signPub` for trusted approval, and the phone signing key
from the phone-add post for the release acknowledgement. Use the decoded
signature and decoded `signInput`. F1 tests must additionally derive the signed and AAD
bytes from structured fields, assert equality with these fixtures and check
rejections when the context, authorization or ciphertext changes.
