# Security policy

Plainphone is used to protect children and to help adults keep a promise to themselves. A way around the lock is a security bug.

## Reporting a bypass

Please report it privately through GitHub: **Security → Report a vulnerability** on this repository. Include the phone model, Android version and security patch level, the Plainphone version and the steps. Do not open a public issue for a working bypass.

We aim to answer within a week. No filter or lock is perfect, and we will say so plainly in the release notes when a bypass is found and fixed.

## Supported versions

Only the newest release is supported. Releases from v0.1.10 use the production signing key. Pre-releases through v0.1.9 used a test key.

## End-to-end encryption

The [encryption specification](docs/encryption.md) defines the model under
development. It has no operator-held decryption key, backdoor or emergency
override. The planned service can disclose retained account and household
metadata, delivery and sync times, the lock-integrity flag, ciphertext and
DNS configuration available to its DNS service. The hosted service is
currently a test version with readable data in its application database.
Plainphone has received no external security audit.

Use the private reporting channel above for flaws that let the server,
another household or a removed device read protected data or alter accepted
state. The specification also describes the APK certificate pin and the
limits of verifying web releases.
