# Plainphone encryption specification

Protocol version 1, phase F0. This document specifies the cryptographic wire
format and trust decisions for F1–F10. The hosted test service still uses its
existing storage model. New data features wait until F3, the encrypted rule
document phase, is merged. There is no compatibility or plaintext fallback in the
encrypted API. A fresh enrollment is required at cutover. Existing plaintext
backups retain their exposure until deleted or expired.

## 1. Threat model

The application server is an untrusted store and relay. Login establishes an
account and API permissions. A locally authenticated household log establishes
cryptographic permissions. An operator, database reader, backup reader or
compromised application server can see the metadata below. With authentic,
uncompromised clients, such an adversary cannot decrypt H/R/L data, grant itself
membership, forge an authorized command or make the phone accept a forged rule
document. It can censor, delay, replay, corrupt or delete data and show different
valid histories to isolated clients. Cryptographic rollback checks apply to
state a client has already accepted and durably stored.

A compromised mailbox grants API access and metadata exposure. It can disrupt
availability. A signed removal is required for normal API phone deletion.
An authorized admin can read and change the phones in its scope, add devices
and remove other admins. Parental disputes remain outside protocol enforcement.
A stolen unlocked admin device or compromised endpoint can exercise that
device's rights. Root or a device reset can bypass local enforcement. A phone
holds its own R and L and can create its own reports. Its key cannot authorize
rules or commands. A shared scope key gives confidentiality between scope
members and outsiders. Writer authenticity comes from signatures.

The application operator has no household private keys, escrow or emergency
override. A lawful disclosure can include retained clear fields, logs and
ciphertext described below. DNS is a separate trust boundary. 112 remains
available independently of Plainphone, and Android ELS/AML can send location
directly to the emergency service where the device and local service support
it. Phone policy MUST preserve emergency dialling and ELS dependencies,
including Google Play services where used. Plainphone's Find is a separate
feature. An authorized parent or emergency contact can choose to share a
position they received.

An active operator controlling the PWA origin can deliver targeted JavaScript
that uses local keys or exfiltrates plaintext. Non-exportable WebCrypto keys
limit direct extraction. They still permit operations by scripts running on the
origin. Store-signed parent apps and a provisioning QR that pins the Android
APK signing certificate reduce that exposure subject to release/signing-key
trust. Published reproducible-build hashes can help verify releases. Cached
PWA assets and a future independently signed release manifest cannot secure
a compromised first load. OS compromise, side channels and traffic analysis
beyond the stated metadata are outside the guarantees.

### Application-server visibility

Column names below use wire-style names. Identifiers, foreign keys, row
presence, lifecycle timestamps, padded ciphertext lengths and traffic timing
remain visible wherever used for routing or retention.

| Data | Clear or visible | Protected |
|---|---|---|
| `users`, `magic_links`, `sessions` | User ID, email, locale, token hashes and expiry/session times | Client-held tokens stay out of storage and logs except as explicitly noted below |
| `households`, `household_members`, `household_invites` | Household ID, membership user IDs and API roles, invitation state and email until accepted | Household name, H |
| `phones` identity | Phone ID, household ID, profile (`child`/`self`), mode (`strong`/`light`), pairing and last-seen times | Phone name, H. Time zone, device model and other device info, R |
| `phones` auth and routing | Device token hash, DNS ClientID, routing/readiness metadata, FCM token | DNS policy in R and separately available to ppdns. Location mode/interval in R. Locate requests use encrypted commands |
| Phone status | `lockIntact` boolean, applied `rulesVersion`, `statusReportedAt`, offline-alert threshold and last alerted time. Transport User-Agent can reveal app version | Battery, detailed protection state, failed policies, DNS host in reports, app version field, time used and observed roster head, R |
| `pairings`, `enrollments` | Short-lived pairing routing fields, public keys, existing transient pairing bearer token where applicable, enrollment token hash, MAC, IDs/times | QR secret under H in the short-lived enrollment record |
| Apps, contacts, time limits/bonuses, schedules | Phone/record routing and update activity | Installed package, label, core/installed flags in signed R app report. Allowed/hidden/selected/catalog installs, names, numbers, limits, bonuses and windows in signed R rules |
| `dns_settings`, `dns_deletions` | ClientID and DNS deletion/readiness state | Allowed/blocked domains and categories in signed R rules. The HPKE copy goes directly to ppdns |
| `locations` | Receipt timestamp and update frequency, which can expose continuous tracking | Coordinates, accuracy, capture time and any command correlation, L. Keep the latest position only |
| `self_keys` | Trusted user ID for routing, trusted email until acceptance. Future payment routing and amounts if payments launch | Expected key type and delay in R |
| `pending_changes` | ID, key type for routing, status, effective/decision times, requester and decider IDs | Operation and authenticated change context, R. A separate per-change key can be shared with the assigned trusted devices |
| `phone_requests` | Status, creation/decision times, keyed dedupe tag. Tag equality exposes repeats within the epoch | Request kind, app package, proposed contact name and number, R |
| `usage_days` | Day and receipt timing for 30-day expiry | Daily totals, per-app totals and unlock counts, R |
| `push_subscriptions`, `notification_mutes` | Endpoint, Web Push routing keys, native token and mute state | Optional label under H for admins. Otherwise omit it |
| `devices`, `household_log` | Device/user IDs, public keys, roles, grants, public epoch commitments, signatures, event order and observed timestamps | Optional device label, H |
| `key_envelopes`, `phone_state` | Scope, epoch, recipient and/or signer IDs, roster head, rules version, public headers/signatures and lengths | Wrapped keys and rules |
| `commands` | Phone and command ID, signer, head, epoch, scope, issue/expiry times, length. Scope R can identify a release while L groups the three emergency actions | Action and encrypted parameters/results |
| Public catalog, edge, delivery | Catalog and requested country, network IP and User-Agent during requests, rate-limit and infrastructure metadata, push/mail routing and send time | The catalog choices of a household go into R |

Push wake-ups to phones contain only a generic sync signal. Push providers see
routing, timing, lengths and any generic text. Use generic mail subjects and
bodies with the minimum alarm, invitation or routing information. Local clients
can render private labels and message details. Map tile vendors can infer a
coarse viewed area and IP from tile requests. Verify actual proxy retention
before promising that IPs are only held in rate-limit memory. Logs MUST exclude
bodies, token-bearing URLs and headers, plaintext, ciphertext and secret material.

## 2. Keys, encoding and primitives

Use one independently random 32-byte key H per household, and independent
32-byte R and L keys per phone. Epochs start at 1 and increment by one for
each scope independently. H protects names and labels. R protects rules,
reports, usage, requests and Self changes. L protects position and emergency
actions. Admins get H and R/L only for their authorized phones. A phone gets
its own R and L. An emergency device gets L for named phones only, including
the latest position if available. A trusted device gets only its designated
per-change key and no R, L or H. Self-phone access MUST be explicitly scoped.
The Self owner MUST approve granting another principal access to that phone.
A recovery device holds only the permissions of the admin principal who
admitted it, subject to its explicit grant.

Each device uses an independent Ed25519 signing key and an independent X25519
HPKE recipient key. Use a cryptographically secure platform RNG. Private keys,
recovery seeds and unwrapped data keys MUST remain client-side. The application
server may have service credentials (TLS, VAPID, account auth). ppdns has its
own separate HPKE recipient key and receives DNS configuration only.

All cryptographic JSON bytes are UTF-8 [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785).
JCS suits the existing JSON transports and produces reproducible bytes on TS
and JVM with reference serializers. Require unique property names, Unicode
scalar values and safe integers in the range `[-(2^53-1), 2^53-1]`, with
no floating-point values or negative zero. Represent fractional measurement fields
as scaled integers, e.g. latitude/longitude in 10⁻⁷ degrees and accuracy in mm.
Preserve Unicode without normalization. Reject duplicates before conversion to
a map and reject unknown fields, unsupported versions, invalid strings and
out-of-range values before use. Object keys use JCS UTF-16 sorting. Array order
is significant. Binary JSON fields are canonical unpadded base64url. Reject
noncanonical encodings, wrong lengths and extra trailing bytes. IDs are
lowercase canonical UUID strings unless specified otherwise; random new IDs
use UUIDv4. Timestamps are integer Unix milliseconds UTC. Explicit `null`
appears only in fields that permit it.

Let `D(p,x) = UTF8(JCS(["plainphone",1,p,x]))`. Hashes are SHA-256 (32 bytes).
Ed25519 is pure RFC 8032 over the stated bytes, with a raw 32-byte public key
and 64-byte signature. Require canonical encodings and reject small-order public
keys. Use strict RFC 8032 verification, including scalar-range checks, and share
negative vectors across platforms in F1. Do not sign a digest in place of the
specified message. In each structure with a `sig`, sign the object with just
that field omitted. Version `v` means format revision, and MUST equal 1.
Version `version` is a record revision counter. Range for stored revision
counters and epochs is 1 through 2⁵³−1.

### Data encryption and signed records

`header = {v,table,householdId,phoneId,recordId,scope,epoch,version}`.
Use `phoneId:null` for H household-only records. `recordId` is the expected
logical record ID, never a server-chosen replacement. For singleton phone
records it is the phone ID. Multiple records (commands, changes, requests and
per-day usage) use distinct stable IDs. An immutable command has version 1.
Signed records add `rosterHead,signerDeviceId` to the header. Commands also add
`issuedAt,expiresAt`. Each record type fixes its table, scope, writer role and
logical owner. Clients MUST check these against their request and local state.

Encode the plaintext as JCS JSON bytes. Pad by prepending its unsigned 32-bit
big-endian length and appending zero bytes to the smallest power-of-two bucket
that fits, with a minimum of 256 and a maximum of 4 MiB. Reject malformed padding,
noncanonical payload bytes and oversized records before applying them. Encrypt
with AES-256-GCM, a fresh random 12-byte nonce and a 16-byte tag. AAD is
`D("blob",header)`. The wire is `{header,nonce,ct}`, with `ct = ciphertext || tag`.
Tink NO_PREFIX AES-GCM takes/returns `nonce || ciphertext || tag`. Never repeat
a nonce for a key, including across writers, retries and restores. Retrying
the same write may reuse the exact sealed bytes. Budget at most 2²⁴ fresh
encryptions per scope epoch across writers. Allow at most 256 distinct writer
devices per epoch, counted from the signed roster, and at most 2¹⁶ seals per
device per epoch, with a durably reserved count before each seal. Count all
writers since epoch creation, including removed writers. Rotate before either
limit. A client missing or rolling back its count MUST stop sealing with that
key. Re-admit restored devices under new IDs and rotate affected keys. R and L MUST NOT be reused
as HMAC keys.

A signed record is `{header,nonce,ct,sig}`, signed over
`D("record",{header,nonce,ct})`. Verify signature, signer permission, roster,
epoch, target and freshness before applying the decrypted payload. Authenticate
clear application fields separately where used for enforcement. Routing fields,
including `lockIntact`, are advisory to the application server and never
authority for phone policy. Phone-written R/L reports MUST carry the phone
signature. H metadata MUST be signed by an admin. A phone name also requires signer authorization for that phone. Trusted approval is over
`D("self-approval",{v,householdId,phoneId,changeId,rosterHead,signerDeviceId,ctHash})`,
where `ctHash` is SHA-256 of the decoded operation ciphertext. The signed
pending change MUST bind the trusted principal, timing and change ID in its
authenticated payload. When sharing a change, seal a copy using a fresh
32-byte per-change key and the change header as AAD. HPKE-wrap that key
separately for the selected trusted devices with the envelope format below.
Each phone re-evaluates loosening against its applied state and measures the
delay locally. Removing or replacing a trusted grant that protects an active
Self rule is itself a loosening operation. The phone MUST keep enforcing the
old requirement until its local Self gate allows that policy change. Never give
a trusted device access to subsequent changes after removal.

### HPKE and key envelopes

Use RFC 9180 base mode (0), KEM `0x0020` X25519/HKDF-SHA256, KDF `0x0001`
HKDF-SHA256 and AEAD `0x0002` AES-256-GCM. Each envelope uses a fresh sender
encapsulation and exactly one seal at sequence zero. X25519 public keys and
`enc` are raw 32-byte values. Reject invalid or low-order recipient and
encapsulation keys using the library's X25519 failure checks.

Envelope = `{header,enc,ct,sig}`. Header =
`{v,householdId,phoneId,scope,epoch,recipientDeviceId,rosterHead,signerDeviceId}`.
H uses `phoneId:null`. R/L require a phone ID. For the per-change key only,
use scope `"change"`, epoch 1, and add `changeId` to the header. Its sender must
be authorized to submit the change and its recipient must be a currently
assigned trusted device for the change or an authorized phone/admin recipient.
The HPKE plaintext is exactly the 32-byte key. Use `info = D("key-envelope",header)`
and zero-length HPKE AAD. Tink's hybrid `context_info` maps to HPKE `info`,
with empty AAD. Tink takes `enc || ct` with a RAW/NO_PREFIX key. `ct` includes
the 16-byte tag. The Ed25519 signature covers
`D("key-envelope",{header,enc,ct})`. HPKE base mode needs this independent
sender authentication. Check the envelope target and the sender and receiver's
authorization at the referenced head and locally accepted head, validate epoch
and scope, then decrypt and compare SHA-256 of the key to the log commitment
for H/R/L. The signed change MUST likewise commit to the per-change key hash
when shared. Do not load keys from unsigned or uncommitted state.

## 3. Membership and freshness

A log post is `{v,householdId,seq,prevHash,type,data,epochs,signerDeviceId,sig}`.
`seq` starts at 0 and increases by one. Sign `D("log",postWithoutSig)`.
The head is SHA-256 of `D("log-head",postIncludingSig)`.
`prevHash` is the immediate predecessor's head. Every post has `epochs`, an
array of `{scope,phoneId,epoch,keyHash}`, sorted by scope then phone ID
(null sorts first). No duplicates. `keyHash` is SHA-256 of the raw scope key.
Unchanged scopes are omitted. Removed phones retire both their scopes and IDs.
All other changes follow the table.

| Type | Exact `data` | Authorization and epoch changes |
|---|---|---|
| `genesis` | `{deviceId,userId,signPub,kemPub}` | Self-signed by the first admin (`signerDeviceId=deviceId`), seq 0, `prevHash:null`, H epoch 1. Initially no phones |
| `device.add` | `{deviceId,userId,signPub,kemPub,role,scope}` | Admin or recovery. Grant can only cover phones the signer can administer. `role` is `admin`, `emergency`, `trusted` or `recovery`. No epoch changes |
| `device.remove` | `{deviceId}` | Admin or recovery with authority over all affected scopes. No removing the last admin unless an active recovery remains. Rotate every H/R/L scope the target could read. Trusted removal also invalidates outstanding trusted approvals for new application, subject to the phone's Self gate |
| `phone.add` | `{phoneId,profile,ownerUserId,deviceId,signPub,kemPub}` | Admin or recovery. `ownerUserId` is null for `child` and the signer’s user ID for `self`. Adds the unique `phone` device for that phone and inits R/L epoch 1 |
| `phone.remove` | `{phoneId}` | Admin or recovery for that phone. Retire phone and phone device. Empty epoch list. Signed removal permits deletion of server data. An enforced phone releases only after a verified `release` action and any applicable Self gate |
| `keys.rotate` | `{}` | Admin or recovery for each listed scope. Nonempty epoch list. Advance each listed scope by one |

A grant `scope` is `"*"` (admin or recovery only) or a sorted, nonempty
array of existing phone IDs. A wildcard grants all current and future child
phones and only those Self phones whose signed `ownerUserId` equals the
device's `userId`. An explicit Self grant to a different user requires a
signature from the Self owner. This includes trusted and emergency devices.
An explicitly delegated admin may control that phone within the admin role
but cannot delegate it further. A recovery device MUST have the same user
ID as its enrolling admin, cannot exceed that admin's scope, and may
bootstrap a regular admin only for that user within its own authority.
A phone's grant is its single `phoneId` from `phone.add`. Only an admin or
recovery with `"*"` may create a phone or grant `"*"`.
At least one wildcard admin or recovery MUST remain for the household and at
least one owner-admin or owner-recovery MUST remain for each Self phone
until the phone is removed. To remove a device, the signer must be able to
administer every phone within the target's active grant. Never reuse retired device IDs, phone IDs or device key material.
All grants are evaluated on the predecessor roster. A `recovery` device may
sign membership/rotation actions and key envelopes. It MUST bootstrap a regular
admin before any rule or command is written.

Pin genesis locally on creation and a verified head on enrollment/admission.
Persist the accepted head, roster, key epochs, applied revision and digest
and replay state atomically with local policy state. Verify consecutive hashes,
sequence, signatures, permissions and resulting state before advancing.
Concurrent writers must resolve at the common predecessor and re-sign after
a compare-and-swap conflict. Accept only descendants of the persisted head.
A same-sequence different head or unrelated branch stops security-sensitive
sync and requires out-of-band comparison. Verify signatures against the
referenced head and also require the signer to still have the permission at
the current accepted head. A historical ancestor is acceptable only with a
current epoch, current permissions and valid record freshness. Rotation and
removal revoke stale head/epoch combinations for the affected scopes. Never
use login, server timestamps or a server roster as a replacement for a lost
local pin. Re-admit the device using a fresh QR or the recovery credential.

A server can partition clients and hold back removals. Clients should exchange
their verified heads using authenticated phone reports or compare the full
base64url head out of band. Compare at the same sequence or verify ancestry
before interpreting a mismatch as a fork. Server CAS helps coordinate honest
writers. It supplies no fork prevention against a dishonest server.

### Rules and commands

Rules use `table:"phone_state",scope:"R",recordId:phoneId` and admin signature.
The encrypted object is `{schema:1,rules:{...}}`, a full policy snapshot.
F3 defines the required policy fields and validation (apps, contacts, schedules,
limits, DNS, location, time zone and Self policy). The F0 fixture exercises the
signed container with a small illustrative policy. It does not define a full
valid F3 policy. Require an increasing version across epochs for each phone.
An identical accepted wire record may be acknowledged idempotently. Reject
lower revisions or distinct bytes at an already accepted revision. Use a
ciphertext/wire digest as ETag and compare-and-swap for concurrent edits.
The phone must independently validate policy and never loosen on an error.
Keep the last valid policy on deletion, authentication failure or sync failure.

Commands use `table:"commands"`, a fresh UUID `recordId`, version 1 and a
signed validity window. The exact encrypted bodies and signer permissions are:

| Body | Scope | Signer and effect |
|---|---|---|
| `{kind:"locate"}` | L | Admin or emergency. Request a single position under phone policy and notify the child on a single-position capture |
| `{kind:"ring",stopAfter}` | L | Admin or emergency. Ring for integer seconds 1–60, with local cancellation |
| `{kind:"okay",deadline}` | L | Admin or emergency. Show the question. Send an encrypted acknowledgement if answered, or one encrypted position under local policy if unanswered. Deadline is Unix ms, greater than `expiresAt` and no later than `issuedAt+900000` |
| `{kind:"release"}` | R | Admin only. A release of a Self phone is a loosening operation and requires the local gate |

Before execution require `issuedAt <= now + 30000`, `expiresAt > now` and
`0 < expiresAt - issuedAt <= 300000`. A phone MUST keep durable replay state
and atomically consume each command ID before triggering its effect. Keep IDs
through expiration and clock skew, and fail closed for commands when trusted
local time is unavailable or has rolled back past the stored high-water mark.
Bound running effects using elapsed time, and carry pending consent and replay
state through restarts. Never interpret server time as a freshness proof.
Apply local location settings and refuse forbidden actions regardless of the
sender. Results are signed by the phone, encrypted under L and carry command
correlation inside the payload.

## 4. Enrollment and recovery

For parent or contact admission, the candidate displays
`{v,householdId,deviceId,signPub,kemPub}` in a QR or the full SHA-256 of
`D("join-device",thatObject)` as an out-of-band comparison. The approving
admin compares the candidate's exact keys with the keys presented for log
inclusion and presents its own currently verified `householdId,rosterHead`
to the candidate over the same authenticated channel. The candidate pins that
head and validates inclusion as a descendant. Login and invitation only grant
API access. A short decimal equality code is not a substitute for the full
fingerprint in this flow. Twelve decimal digits would provide under 40 bits.

For managed-phone provisioning the authenticated QR carries
`{v,householdId,phoneId,profile,ownerUserId,rosterHead,s}` alongside the
existing enrollment token and APK certificate pin. `s` is 16 random bytes used for one enrollment
attempt. Never send it in plaintext through the API. For resumability, keep it
locally or store an H-encrypted signed enrollment blob with table
`"enrollments"`, phone ID and enrollment ID bound by AAD. Delete it when
consumed or expired (within 24 hours). The phone sends its freshly generated
`deviceId,signPub,kemPub` and
`enrollMac = HMAC-SHA256(s,D("enroll",{householdId,phoneId,profile,ownerUserId,rosterHead,deviceId,signPub,kemPub}))`
with the existing bearer token. The admin checks the QR context and compares
the MAC in constant time, then binds the authenticated keys in `phone.add`.
Atomically consume the attempt on successful admission. Before using envelopes
or rules, the phone checks that the accepted post matches its own key pair
and the QR's profile and owner, and descends from the QR head. Before that, retain restrictive enrollment defaults.

For phone-initiated pairing with an authenticated camera scan, have the phone
generate and display a fresh 16-byte `s` in the QR URL fragment. Bind the
pairing ID to the locally pending QR secret. The admin scans the QR, chooses
the phone ID and profile, and sends
`{householdId,phoneId,profile,ownerUserId,rosterHead,pairingId,mac}` with
`mac=HMAC-SHA256(s,D("pair-context",{householdId,phoneId,profile,ownerUserId,rosterHead,pairingId}))`.
The phone verifies this MAC and ties the context to its pending pairing before
returning the enrollment MAC and its keys. The admin verifies the latter
before adding the phone. Both parties consume the pending pairing once.
Do not leak fragment values to telemetry or URL logs. If pairing is entered
by hand, the short lookup code is routing only. Transfer the same 128-bit
secret over a trusted channel before admission. A six-digit manually compared
hash of server-relayed keys alone is vulnerable to active key grinding. Both pairing directions require an
authenticated transfer of the household head from admin to phone before
acceptance.

The paper recovery code stores a 16-byte uniformly random seed, encoded as
RFC 4648 uppercase base32 without padding (26 symbols) in groups of
4-4-4-4-4-4-2 after `PP-`. Reject nonzero unused bits. Record the household
ID next to the code. Derive two separate 32-byte outputs with RFC 5869
HKDF-SHA256 using the seed as IKM, a 32-byte zero salt and
`D("recovery",{householdId,use:"sign"})` or `D("recovery",{householdId,use:"kem"})`
as info. The first is the Ed25519 seed. Pass the second as IKM to HPKE
DHKEM `DeriveKeyPair`; do not reinterpret it as the raw X25519 private key.
The recovery public keys are admitted like another device, with the enrolling admin’s user ID, an authorized scope and
signed envelopes. The paper copy MUST also carry an authenticated log
checkpoint (household ID, sequence and full head at activation). Verify log
ancestry, current inclusion and public keys before using the code. Refuse
recovery when the newest locally known head disagrees or removes the recovery
key. With only a paper checkpoint, withholding later history remains possible.
Recovery admits a new regular admin, which can issue a replacement code and
remove the old credential. Losing every admin and the recovery material makes
the encrypted data unrecoverable by the operator. The phone retains its last
valid rules.

### Rotation and deletion

Generate new independent keys for each affected scope. Publish the signed log
change, its committed keys' envelopes for remaining authorized devices and the
new signed rules (with incremented versions) for affected phones as one compare-and-swap batch against the
previous head. A client seeing the new head without the new epoch materials
MUST stop new writes for those scopes, retain last valid local enforcement and
retry. Readers reject new data under retired epochs. Have each authorized writer re-encrypt and re-sign its live records. Delete
retained records that cannot be reissued by an authorized writer. Revoke API sessions and
subscriptions for removed devices. On removal of a phone, delete its
envelopes and blobs and forget scope keys on authorized clients. On account
deletion, obtain signed removals where available and have remaining admins
rotate the affected scopes. Clearing server data or revoking sessions alone
cannot revoke a signing key cryptographically.

Rotation protects data made under fresh keys once clients accept the new
roster. It cannot recall already downloaded data or erase keys held on a
removed or offline device. Keeping only the latest position limits retention.
It supplies no cryptographic forward secrecy for captured historical
ciphertext and keys. Backup crypto-shredding depends on deletion of all
copies of relevant keys and envelopes that retained recipient keys can open.
The small device sets and need to share current state favor per-recipient HPKE
envelopes over the additional group protocol and runtime bindings of MLS.

For an R phone request, derive a separate dedupe key with HKDF-SHA256 (R as
IKM, 32 zero salt bytes, 32-byte output,
`D("dedupe-key",{householdId,phoneId,epoch})` as info).
Tag = HMAC-SHA256(dedupeKey,`D("dedupe",{kind,value})`). Use
`kind:"app"` with exact canonical package identifier or `kind:"contact"`
with normalized E.164 number. Contact display name is excluded from
deduplication. Never equate epoch-spanning tags.

## 5. DNS filtering

ppdns is the recipient of its own HPKE configuration. An admin sends it
directly to the pinned ppdns HTTPS origin after obtaining authorization to
configure that ClientID. PWA CORS and a narrowly scoped, short-lived DNS
configuration grant are F9 requirements. The app API and its database do
not receive the policy copy. The wire is `{header,enc,ct}`, with
`header={v,householdId,phoneId,clientId,revision,ppdnsKeyId}`. Here
`ppdnsKeyId` is SHA-256 of the pinned raw X25519 public key. Use base-mode
HPKE, `info=D("dns-config",header)`, empty AAD and JCS plaintext
`{allowDomains,blockDomains,blockedCategories}`. Each array is sorted,
duplicate-free and contains canonical values (ASCII lower-case DNS names
without a terminal root dot, or known category identifiers). ppdns MUST route
only to the grant-bound ClientID, reject replayed/older revisions, and drop
transport payloads from logs. This endpoint uses API authorization. HPKE base
mode supplies no sender authentication. The DNS operator or a compromised
control plane can still alter the DNS filter. The phone's signed R policy
remains independently authenticated.

Bundle the hosted public key with native code and the PWA release. For
self-hosters pin the configured key at first use, preferably authenticated
out of band. Require explicit re-verification on key change. Keep ppdns'
private key separate from the app service. The resolver sees live query names,
categories and custom domains. Disable query logging and per-client statistics,
disable ECS, keep IP anonymization, and use aggregate totals without names
or ClientIDs if needed. DNS backups can retain ClientID-to-policy mappings
(14 days in the design), which an operator can correlate with the app database.
The operator could enable future logging. The resolver itself should use only
the pseudonymous ClientID, with no user profile or account email. The no-operator
key claim concerns client H/R/L data and does not cover data disclosed to ppdns.

## 6. Library choices and verification

These pins are F1 starting points. F0 installs only the TypeScript vector
dependencies. The protocol is independent of implementation version. Changes
of library version must pass the same cross-runtime vectors and negative cases.

| Target | Selected libraries and storage | Evidence and maintenance |
|---|---|---|
| PWA | WebCrypto for randomness, SHA-256, HMAC, HKDF, AES-GCM, and native X25519 or Ed25519 when usable. Persist the complete X25519 key pair and pass both keys to HPKE decapsulation so it need not export the private key. `@hpke/core` **1.10.1** (MIT) for HPKE. On browsers lacking native X25519 use `@hpke/dhkem-x25519` **1.8.1** (MIT, noble-based, with `@hpke/common` **1.13.0**). For missing Ed25519 use `@noble/curves` **2.4.0** and its `@noble/hashes` **2.4.0** dependency (MIT). Keep native keys non-exportable in IndexedDB. Store software private bytes encrypted with a non-exportable, local WebCrypto AES-GCM storage key | hpke-js is maintained by Ajitomi Daisuke, with November 2026 releases, RFC 9180 and Wycheproof coverage. Upstream explicitly reports no formal audit. Noble is maintained by Paul Miller, with the 2.4.0 releases in August 2026. Its upstream review history describes scoped reviews and subsequent changes. No exact-release audit is assumed. [HPKE project](https://github.com/dajiaji/hpke-js) · [noble-curves](https://github.com/paulmillr/noble-curves) · [noble-hashes](https://github.com/paulmillr/noble-hashes) |
| Expo parent app | `react-native-quick-crypto` **1.1.9** (MIT) as the native WebCrypto provider with `@hpke/core` **1.10.1**. Install the provider before HPKE initializes, use a custom Expo development/production build with Nitro Modules, and test on Expo SDK 58 / RN 0.88.1. Secure private key bytes locally with `expo-secure-store` **58.0.3** (MIT, already used by the app), with optional app-level biometric access and backup exclusions | The maintained Margelo adapter's 1.1.9 release is dated October 2026. The tagged compatibility matrix lists secure randomness, raw OKP key import/export, X25519, Ed25519, AES-GCM, SHA-256, HKDF and HMAC. It uses native crypto and requires RN 0.75+ in the documented new-architecture setup. Expo Go does not provide the selected native module. The exact SDK/OS integration remains a device test. [Tagged coverage](https://github.com/margelo/react-native-quick-crypto/blob/v1.1.9/.docs/implementation-coverage.md) · [Release](https://github.com/margelo/react-native-quick-crypto/releases/tag/v1.1.9) · [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/) |
| Managed Android phone (minSdk 29) | `com.google.crypto.tink:tink-android` **1.24.0** (Apache-2.0). Use NO_PREFIX HPKE, AES-GCM and Ed25519. Protect local keysets with an AES-GCM key in Android Keystore, reject plaintext storage on Keystore failures and exclude keysets from backup. Use Tink's software X25519 and Ed25519 with Keystore protection at rest | Tink is actively maintained, with Android artifact 1.24.0 released October 2026. Official support starts at API 24. Tink Java supports both key types and the chosen suite. This design does not rely on Android 10 providing direct X25519/Ed25519 hardware keys. [Android setup](https://developers.google.com/tink/setup/java) · [Wire format](https://developers.google.com/tink/wire-format) · [Known issues](https://developers.google.com/tink/known-issues) |
| Canonical JSON | `canonicalize` **5.1.0** (Apache-2.0) in TS and `io.github.erdtman:java-json-canonicalization` **1.1** (Apache-2.0) on the JVM. Validate the restricted input profile separately | The TS reference package shipped 5.1.0 in September 2026. The JVM reference artifact dates to August 2018 and has low release activity. The shared JCS fixture checks byte parity. [TS reference](https://github.com/erdtman/canonicalize) · [JVM reference](https://github.com/erdtman/java-json-canonicalization) |

Safari 16.4 on iOS requires both curve fallbacks. Safari 17 announces
Ed25519. Apple documents X25519 support and OKP key operations in Safari
18.4. Android Chrome ships native X25519 from Chrome 133 and Ed25519
from Chrome 137. Treat these versions as guidance and feature-test actual
key generation, serialization of public keys, sign/verify or HPKE
seal/open, and persistence of local keys. Select the curve backend
independently for each algorithm. If the required WebCrypto base features,
secure randomness or durable storage fail, stop enrollment and direct users
to the parent app. Request persistent storage when available and recommend
home-screen installation on iOS. Browser storage loss requires re-admission.
Signatures from browser providers may be randomized and still verify under
RFC 8032. The fixture generator uses deterministic signatures for stable
known answers. Consumer interoperability means verification of the published
signature, not byte equality of freshly signed messages. [Safari 17](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/) ·
[Safari 18.4](https://developer.apple.com/documentation/safari-release-notes/safari-18_4-release-notes) ·
[Chrome X25519](https://chromestatus.com/feature/6291245926973440) ·
[Web Crypto compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/SubtleCrypto.json) ·
[WebKit storage behavior](https://webkit.org/tracking-prevention/)

### What has received no external review

Plainphone's specification, cross-platform integration, storage lifecycle,
roster and enrollment protocols, Self enforcement, DNS authorization and
release delivery have received no external security audit. Upstream
maintenance, upstream testing and conformance vectors give different
evidence from a Plainphone audit. Public documentation must reflect this.
F1 must consume the same JSON fixtures from both TypeScript and Kotlin,
including real-device tests at the browser and Android support floor and
an Expo build on iOS and Android. F10 must exercise adversarial cases for
key substitution, forged or rolled-back rules, forked heads, stale or
cross-scope envelopes, revoked signers, command replay, Self delay bypass
and data exposure in database dumps, logs, push and mail. Run the data
canary against the pre-cutover implementation to demonstrate detection.

F0 runs Node 24 native WebCrypto and the selected PWA curve fallbacks in
CI. A localhost Chrome 157 probe opened the fixture with both X25519
backends, generated a native non-exportable X25519 private key and verified
the fixture's signature with native Ed25519. A JVM probe with the actual tink-android 1.24.0 artifact successfully
opened the TypeScript envelope, rejected changed HPKE info, round-tripped
fresh Tink HPKE, verified the rule signature and opened the rule AES-GCM
ciphertext. The JVM JCS artifact matched the JCS fixture. These are
host-side checks, so they do not exercise Android 10 providers or Keystore. See the [fixture guide](encryption-test-vectors/README.md)
for the exact commands and input encoding.
