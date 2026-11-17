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
remain visible wherever used for routing or retention. `lockIntact` is the
only clear phone-state value. Identifiers and transport metadata in this table
remain visible as described.

| Data | Clear or visible | Protected |
|---|---|---|
| `users`, `magic_links`, `sessions` | User ID, email, locale, token hashes and expiry/session times | Client-held tokens stay out of storage and logs except as explicitly noted below |
| `households`, `household_members`, `household_invites` | Household ID, membership user IDs and API roles, invitation state and email until accepted | Household name, H |
| `phones` identity | Phone ID, household ID, profile (`child`/`self`), admin-configured mode (`strong`/`light`), pairing and last-seen times | Phone name, H. Time zone, device model and other device info, R |
| `phones` auth and routing | Device token hash, DNS ClientID, routing and admin-configured readiness, FCM token | DNS policy in R and separately available to ppdns. Location mode/interval in R. Locate requests use encrypted commands |
| Phone status | `lockIntact` boolean, `statusReportedAt`, offline-alert threshold and last alerted time. Transport User-Agent can reveal app version | Battery, detailed protection state, failed policies, DNS host in reports, app version field, time used, applied `rulesVersion` and observed roster head, R |
| `pairings`, `enrollments` | Short-lived pairing routing fields, public keys, existing transient pairing bearer token where applicable, enrollment token hash, MAC, IDs/times | QR secret stays on the initiating device |
| Apps, contacts, time limits/bonuses, schedules | Phone/record routing and update activity | Installed package, label, core/installed flags in signed R app report. Allowed/hidden/selected/catalog installs, names, numbers, limits, bonuses and windows in signed R rules |
| `dns_settings`, `dns_deletions` | ClientID, DNS deletion activity and admin-configured DNS readiness | Allowed/blocked domains and categories in signed R rules. The HPKE copy goes directly to ppdns |
| `locations` | Receipt timestamp and update frequency, which can expose continuous tracking | Periodic coordinates, accuracy and capture time, R. Keep only the latest periodic position. Command results go only to the requesting device |
| `self_keys` | Trusted user ID for routing, trusted email until acceptance. Future payment routing and amounts if payments launch | Expected key type and delay in R |
| `pending_changes` | ID, key type for routing, status and receipt/retention times, requester and decider IDs | Operation, effective/expiry times and authenticated change context, R or a per-change key for trusted approval |
| `phone_requests` | Status, creation/decision times, keyed dedupe tag. Tag equality exposes repeats within the epoch | Request kind, app package, proposed contact name and number, R |
| `usage_days` | Day and receipt timing for 30-day expiry | Daily totals, per-app totals and unlock counts, R |
| `push_subscriptions`, `notification_mutes` | Endpoint, Web Push routing keys, native token and mute state | Optional label under H for admins. Otherwise omit it |
| `devices`, `household_log` | Device/user IDs, public keys, roles, grants, public epoch commitments, signatures, event order and observed timestamps | Optional device label, H |
| `key_envelopes`, `phone_state` | Scope, epoch, recipient and/or signer IDs, roster head, rules version, public headers/signatures and lengths | Wrapped keys and rules |
| `commands` | Phone and command ID, signer, head, epoch, scope, issue/expiry times, length. Scope R can identify a release while L groups the three emergency actions. | Action and encrypted parameters/results for ordinary commands |
| Public catalog, edge, delivery | Catalog and requested country, network IP and User-Agent during requests, rate-limit and infrastructure metadata, push/mail routing and send time | The catalog choices of a household go into R |

Clear `mode` and readiness describe what the admin configured for enrollment
and routing. They MUST NOT report the mode or readiness actually observed on
the phone.

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
reports, usage, requests and Self changes that lack a per-change key.
L protects the three emergency commands. Admins get H and R/L only for
their authorized phones. A phone gets its own R and L. An emergency device
gets L for named phones and can request Find, Ring or “Are you okay?”. It
gets neither periodic positions nor results addressed to other devices. A trusted device gets only its designated
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
and 64-byte signature. Require canonical encodings of public point A and
signature point R, reject small-order A and R (including the identity),
require 0 ≤ S < L (the subgroup order), and verify the non-cofactored
equation [S]B = R + [k]A from [RFC 8032 §5.1.7](https://www.rfc-editor.org/rfc/rfc8032#section-5.1.7).
All native, noble and Tink backends MUST use strict profile verification
through the common verifier for their runtime. Provider defaults, including
noble with `zip215:false`, are insufficient on their own. Every backend MUST
reject all `negative.ed25519` fixtures. Do not sign a digest in place of the
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
that fits, with a minimum of 256 and a maximum of 4 MiB including the length
prefix (maximum JCS length 4 MiB minus four bytes). Reject malformed padding,
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
authority for phone policy. Phone-written reports MUST use R and carry the phone signature. Never
write a phone report under L. Command results use independent HPKE to the
requester as specified below. H metadata MUST be signed by an admin. A phone name also
requires signer authorization for that phone. Every H/R/L blob and every
per-change blob MUST be signed. Public catalog and API routing metadata
are outside the signed blob format and confer no cryptographic authority.

Every Self loosening, including removing or replacing an active trusted
requirement, requires a signed change record with
`table:"pending_changes",version:1,recordId:changeId`. Use the current R
epoch in the record header. Use scope R when no trusted approval is required.
When approval is required, use `scope:"change"` and seal once under a fresh
random 32-byte key. Wrap that key to the phone, the authorized admins who
need it, and the designated trusted devices. Recipients verify signer,
envelope and header bindings and review that exact decrypted operation.

The plaintext is `{op,trustedUserId,baseRulesVersion,baseRulesDigest,effectiveAt,expiresAt}`.
`trustedUserId` is null for changes without trusted approval.
`baseRulesDigest` is SHA-256 of `D("rules-digest",appliedSignedRulesWire)`.
`op` is a deterministic operation on the base policy, defined by F3.
The phone requires the exact applied base revision and digest, the current
R epoch, a fresh UUID, and `effectiveAt < expiresAt`. It requires trusted local
time before first observation and application, rejects expired changes, and
uses `effectiveAt` only as an additional lower bound. At commitment, require
`effectiveAt <= trustedNow < expiresAt` and the full accumulated delay.

A trusted approval is
`{v,householdId,phoneId,changeId,rosterHead,signerDeviceId,recordHash,keyHash,baseRulesVersion,baseRulesDigest,expiresAt,sig}`.
The trusted device signs `D("self-approval",approvalWithoutSig)` after
displaying the exact decrypted operation and context. The phone matches
the base fields and expiry against the change and recomputes
`recordHash = SHA-256(D("self-change",signedChangeRecord))` and
`keyHash = SHA-256(D("self-change-key",base64url(changeKey)))`.
Verify the approval's IDs and signer at both the referenced and current
heads. The applied Self policy authorizes specific trusted device IDs and
their signed `userId` for this phone. A matching user ID alone grants nothing.
Removal immediately prevents new approvals and use of outstanding approvals
from the removed device. It does not remove the applied Self requirement. If the trusted device is
lost, another device already designated by the applied policy may approve
replacement. If no such device is available, keep enforcing the current
policy. The owner can recover through a local factory reset and fresh
enrollment where the platform permits it, losing local Plainphone state.
Recovery credentials and the relay do not bypass the trusted requirement.

On the first successful authenticated observation, durably store the
change ID, signed-record digest, boot count, `elapsedRealtime()` checkpoint,
and zero accumulated delay. Reject different bytes for an observed ID.
Measure the delay required by the applied base using only nonnegative
same-boot elapsed deltas. Persist the accumulated duration and checkpoint
atomically and checkpoint periodically and on orderly shutdown. On reboot,
resume from the saved duration with a new checkpoint and give no credit for
uncheckpointed time from a prior boot or time powered off. A process restart
in the same boot can use the saved checkpoint. Missing, inconsistent or
regressing time state blocks the change. A wall-clock jump blocks execution
until trusted local time is re-established and cannot advance the delay.
A retry cannot reset a valid timer or move its first observation earlier.

The admin supplies a signed full rules snapshot at exactly
`baseRulesVersion + 1` under the current R epoch. The phone applies `op` to
the actual base in memory, validates the resulting policy, and requires
exact canonical equality with the candidate snapshot before committing.
The Self gate applies to every loosening snapshot even if sent without a
change record. The phone atomically consumes the ID and persists the new
policy, signed snapshot, revision, digest and enforcement intent before
reconciling local enforcement idempotently. Keep consumed IDs durably for
the lifetime of this phone identity. A duplicate delivery may acknowledge the
already accepted snapshot but cannot apply the operation again. Any intervening
rules revision or R epoch invalidates the pending change and approval.
Reissue against the new base with a fresh ID, fresh delay and fresh approval.
Keep prior enforcement on failure, including if incrementing the base
would exceed the revision counter range.

### HPKE and key envelopes

Use RFC 9180 base mode (0), KEM `0x0020` X25519/HKDF-SHA256, KDF `0x0001`
HKDF-SHA256 and AEAD `0x0002` AES-256-GCM. Each envelope uses a fresh sender
encapsulation and exactly one seal at sequence zero. X25519 public keys and
`enc` are raw 32-byte values. Reject invalid or low-order recipient and
encapsulation keys using the library's X25519 failure checks.

Envelope = `{header,enc,ct,sig}`. Header =
`{v,householdId,phoneId,scope,epoch,recipientDeviceId,rosterHead,signerDeviceId}`.
H uses `phoneId:null`. R/L require a phone ID. For the per-change key only,
use scope `"change"`, the same current R epoch as the change record, and
add `changeId` to the header. Its sender must
be authorized to submit the change and its recipient must be a currently
assigned trusted device for the change or an authorized phone/admin recipient.
The HPKE plaintext is exactly the 32-byte key. Use `info = D("key-envelope",header)`
and zero-length HPKE AAD. Tink's hybrid `context_info` maps to HPKE `info`,
with empty AAD. Tink takes `enc || ct` with a RAW/NO_PREFIX key. `ct` includes
the 16-byte tag. The Ed25519 signature covers
`D("key-envelope",{header,enc,ct})`. HPKE base mode needs this independent
sender authentication. Check the envelope target and the sender and receiver's
authorization at the referenced head and locally accepted head, validate epoch
and scope, then decrypt and compare the domain-separated key hash to the log commitment
for H/R/L. For a per-change key, require an envelope signed by the change signer, bound to the same
household, phone, change ID, R epoch and roster head. For execution requiring trusted
approval, require the approval to bind that key as specified above. An R epoch
change invalidates outstanding approvals. Reissue the change with a new ID
and key and obtain a new approval if it is still needed.

## 3. Membership and freshness

A log post is `{v,householdId,seq,prevHash,type,data,epochs,signerDeviceId,sig}`.
`seq` starts at 0 and increases by one. Sign `D("log",postWithoutSig)`.
The head is SHA-256 of `D("log-head",postIncludingSig)`.
`prevHash` is the immediate predecessor's head. Every post has `epochs`, an
array of `{scope,phoneId,epoch,keyHash}`, sorted by scope then phone ID
(null sorts first). No duplicates. `keyHash` is SHA-256 of
`D("scope-key",{scope,phoneId,epoch,key:base64url(scopeKey)})`.
Unchanged scopes are omitted. Removed phones retire both their scopes and IDs.
All other changes follow the table.

| Type | Exact `data` | Authorization and epoch changes |
|---|---|---|
| `genesis` | `{deviceId,userId,signPub,kemPub}` | Self-signed by the first admin (`signerDeviceId=deviceId`), seq 0, `prevHash:null`, H epoch 1. Initially no phones |
| `device.add` | `{deviceId,userId,signPub,kemPub,role,scope,relationship,selfPhoneIds}` | Admin may admit an admin, emergency or trusted device for child phones it administers. An owner admin must sign for each Self phone in the grant. An owner recovery may grant Self access only when bootstrapping its own admin. An admin may admit recovery only as its own device and within its scope. Recovery may admit only a regular admin as its own device within its scope. No epoch changes |
| `device.grant-self` | `{deviceId,phoneId}` | Owner admin or owner recovery for the named Self phone. An existing eligible device gains explicit access, subject to the recovery restriction below. No epoch changes |
| `device.remove` | `{deviceId}` | Admin or recovery with authority over all affected scopes. No removing the last admin unless an active recovery remains. Rotate every H/R/L scope the target could read. Trusted removal also invalidates outstanding trusted approvals for new application, subject to the phone's Self gate |
| `phone.add` | `{phoneId,profile,ownerUserId,ownerPrincipalId,deviceId,signPub,kemPub}` | Admin with wildcard. Both owner fields are null for `child`. For `self`, use the signer’s signed user ID and roster-derived principal ID, and give the signer explicit ownership access. Adds the unique `phone` device for that phone and inits R/L epoch 1 |
| `phone.remove` | `{phoneId}` | Admin or recovery for that phone. Retire phone and phone device. Empty epoch list. Signed removal permits deletion of server data. For remote release followed by removal, require the phone acknowledgement below before signing this post |
| `keys.rotate` | `{}` | Admin or recovery for each listed scope. Nonempty epoch list. Advance each listed scope by one |

A grant `scope` is either `"*"` (admin or recovery only) or a sorted
array of child phone IDs. Wildcards cover current and future child phones.
`selfPhoneIds` is a sorted array of existing Self phone IDs. An explicit
grant must cover at least one phone across the two arrays. Both arrays
reject duplicates. Only a wildcard signer can grant wildcard child access,
and every granted phone must be within the signer's scope.

Genesis starts a principal identified by its device ID. For `device.add`,
`relationship` is either `"own"` (“my own device”) or `"other"`
(“another person”), explicitly selected by the signer and included in the
signed post. `"own"` is valid only for admin/recovery admissions and requires
the same authenticated user ID as the signer. It inherits the signer's
principal ID. `"other"` starts a distinct principal identified by the new
device ID, even if the same user ID appears elsewhere. Neither relationship
nor a matching user ID automatically grants any Self access.

For each `selfPhoneIds` entry, the post's signer MUST be an active admin or
recovery with access to that phone and with the phone's `ownerPrincipalId`.
The signature on the post explicitly grants access to those IDs. A delegate
may administer the Self phone within its role but may neither grant its
access nor create an owner device. Only the signer of a new Self phone
automatically acquires access to it. Other devices of the same principal
require a signed explicit grant. An owner may sign a new `device.grant-self`
post with exact data `{deviceId,phoneId}` for an already admitted device.
It adds that phone to its Self grant, requires the same owner authorization
as `device.add`, and makes no epoch changes. A recovery signer may use this post only for an admin in its own principal.
Granting to a recovery recipient requires that the recipient share the owner
principal.

A phone's grant is its single `phoneId` from `phone.add`. At least one
wildcard admin or recovery MUST remain, and each Self phone MUST retain at
least one owner admin or owner recovery with explicit access. Device removal
requires authority over every phone in the target's grant and owner
authority over any affected Self owner role. Never reuse retired phone IDs,
device IDs or device key material. Evaluate grants on the predecessor roster.
Recovery may sign the membership/rotation actions authorized here and key
envelopes. It MUST bootstrap a regular admin before writing rules or commands.

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

### Phone reports

Phone-written R reports MUST increment `version` per logical record
`(householdId,phoneId,table,recordId)`, starting at 1 and continuing across
epoch changes. Latest periodic position uses scope R, `table:"locations"` and a singleton
record ID equal to the phone ID. The phone durably reserves the next version before sealing and retries
with identical bytes. It must stop publishing under that identity if it loses
the counter state. Re-enroll under a fresh phone identity after such loss.

Readers MUST persist the highest accepted version and digest of the complete
signed wire record per logical record before exposing the report. Reject
lower versions and conflicting bytes at the same version. Identical bytes
are idempotent. Persist these marks across restarts, local cache deletion and
epoch rotation for the lifetime of the logical record. Rotation reissues
only current data with a new version. Readers without a prior mark cannot
detect a withheld newer report, and the relay can always suppress updates.

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
| `{kind:"okay",deadline}` | L | Admin or emergency. Show the question. Send an encrypted acknowledgement if answered. Only an admin request may yield one encrypted position if unanswered, under local policy. Deadline is Unix ms, greater than `expiresAt` and no later than `issuedAt+900000` |
| `{kind:"release"}` | R | Admin only. A release of a Self phone is a loosening operation and requires the local gate |

Before execution require `issuedAt <= now + 30000`, `expiresAt > now` and
`0 < expiresAt - issuedAt <= 300000`. A phone MUST keep durable replay state
and atomically consume each command ID before triggering its effect. Keep
consumed IDs for the lifetime of the phone identity, including across reboot.
Release and Self changes require an accepted UTC anchor. Find, Ring and
“Are you okay?” remain available to authorized senders without one. In that
case enforce the signed window shape and maximum duration, bound the local
effect from receipt using elapsed time, and visibly mark the action as having
unverified freshness. Delivery of an unseen stale command is possible in this
mode. If time becomes trusted, apply UTC freshness checks to pending effects.
Bound running effects using elapsed time, and carry pending consent and replay
state through restarts. Never interpret server time as a freshness proof.
Apply local location settings and refuse forbidden actions regardless of the
sender. For each result, use an independent HPKE seal to the initiating device's
verified KEM key. Require that device still hold the command permission
when producing and accepting the result. Wire `{header,enc,ct,sig}` uses header
`{v,householdId,phoneId,commandId,epoch,rosterHead,signerDeviceId,recipientDeviceId}`,
with the current L epoch and phone device signer. Use
`info=D("command-result",header)`, empty AAD, and the length-prefixed padded
JCS result. Sign `D("command-result",{header,enc,ct})`. Check the original
command ID, recipient, phone signature, current epoch and both head permissions
before opening. Use a fresh capture for a Find response. The recipient
accepts at most one terminal result per command. Emergency contacts can
receive a position only for their own Find request, and a check-in response
only for their own “Are you okay?” request.

For emergency Find the phone MUST enforce a limit of four accepted requests
per sender device in a rolling hour, regardless of command UUID. Count a
request before attempting capture. Durably update the replay state and quota
together before any effect. Measure the window with elapsed time. Across
reboot without trusted UTC, retain unexpired charges for up to a full hour
of elapsed time in the new boot, without credit for powered-off time. On
reaching the limit, show a persistent indicator on the phone and notify admins
via an encrypted R report. Deduplicate notifications per sender and limit
episode. Keep the indicator until the limit clears. Continue to enforce the
local location policy.

Trusted local time is a signed UTC estimate advanced by same-boot
`elapsedRealtime()`. The phone generates a fresh 32-byte nonce, remembers
the boot and elapsed send time and challenges an authorized admin device.
The admin signs `D("time-anchor",{utc,nonce})` using trustworthy UTC from
its platform, independently of the application relay. The phone verifies
the signature, current admin permission for the phone, exact pending nonce,
same boot and an elapsed round trip of at most 30 seconds. Consume the
nonce on success. Use the signed UTC as the conservative estimate at
receipt and advance it only by subsequent same-boot elapsed time.
Persist the boot identifier (`Settings.Global.BOOT_COUNT` on Android),
elapsed checkpoint and accepted UTC high-water mark. Invalidate the anchor
on reboot, monotonic rollback, inconsistent state or a detected wall-clock
discontinuity. Reject responses below the stored high-water mark. Re-anchoring
never credits elapsed Self delay. Raw RTC and relay time cannot serve as anchors.

### Release before remote removal

For a release-and-remove request, keep the phone enrolled with its scope
keys, command routing and pending Self state until release is confirmed.
If the command expires before acceptance, send a newly signed command with
a fresh ID and validity window. The phone persists an accepted release
intent and must preserve any applicable Self delay across restarts. For Self
release, require the same change gate and atomic rule revision as any other
loosening, with a released state defined by F3 and tied to the accepted
release intent. Revalidate the base, approval and expiry at commitment.
Retries preserve the pending intent and its delay. Only after completing
release does the phone write a signed R report with
`table:"phone_reports",recordId:commandId`, initial version 1 and plaintext
`{kind:"release-ack",commandId}`. Persist the acknowledgement and keep
retrying delivery until removal is observed. If rotation retires the report's
epoch before delivery, reissue with the next report version in the new epoch. An already released phone may acknowledge
a fresh valid retry for the same release request without applying release again.
The relay requires only the signed removal post for deletion.
The admin verifies the signature against the acknowledged head and current
roster, and matches the command ID to a release sent for that phone before
signing `phone.remove`. Queueing, expiry or server status never confirms release.
Explicit data-only removal may proceed without confirmation, with the
understanding that an enforced phone retains its last policy and remote
release will no longer be possible.

## 4. Enrollment and recovery

For parent or contact admission, the approving admin first shows an
in-person QR containing `{v,householdId,rosterHead}`. The candidate scans
it and pins the head. For remote admission, compare the full household ID
and head over an independently authenticated channel before pinning.
The candidate then shows `{v,householdId,deviceId,userId,signPub,kemPub}`
by QR or compares the full base64url SHA-256 of `D("join-device",thatObject)`
over that channel. The admin checks every field against the proposed post
and explicitly selects its relationship and grants. A trusted candidate uses
its `trustedUserId` as the authenticated `userId` in this object. The
candidate checks its exact fields, intended role and grants in the inclusion
post and verifies ancestry from its pin. Login and invitation grant API
access only. Short numeric codes are routing information.

For managed-phone provisioning the authenticated QR carries
`{v,householdId,phoneId,profile,ownerUserId,ownerPrincipalId,rosterHead,s}` alongside the
existing enrollment token and APK certificate pin. `s` is 16 random bytes used for one enrollment
attempt. Keep it in protected local storage on the initiating admin device
only, bound to the QR context. Never upload it, including under H. Other
household admins may hold H without authority over the target Self phone.
If local state is lost, restart provisioning with a new QR and secret.
Delete the secret when consumed or expired (within 24 hours). The phone
sends its freshly generated
`deviceId,signPub,kemPub` and
`enrollMac = HMAC-SHA256(s,D("enroll",{householdId,phoneId,profile,ownerUserId,ownerPrincipalId,rosterHead,deviceId,signPub,kemPub}))`
with the existing bearer token. The admin checks the QR context and compares
the MAC in constant time, then binds the authenticated keys in `phone.add`.
Atomically consume the attempt on successful admission. Before using envelopes
or rules, the phone checks that the accepted post matches its own key pair
and the QR's profile and both owner fields, and descends from the QR head. Before that, retain restrictive enrollment defaults.

For phone-initiated pairing with an authenticated camera scan, have the phone
generate and display a fresh 16-byte `s` in the QR URL fragment. Bind the
pairing ID to the locally pending QR secret. The admin scans the QR, chooses
the phone ID and profile, and sends
`{householdId,phoneId,profile,ownerUserId,ownerPrincipalId,rosterHead,pairingId,mac}` with
`mac=HMAC-SHA256(s,D("pair-context",{householdId,phoneId,profile,ownerUserId,ownerPrincipalId,rosterHead,pairingId}))`.
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
4-4-4-4-4-4-2 after `PP-`. On input, remove ASCII space, tab, CR, LF
and ASCII hyphens, uppercase ASCII letters and require `PP` followed by
exactly 26 base32 symbols. Reject 0 and 1 without aliasing them to O or I.
Reject nonzero unused bits. Record the household
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
with a canonical E.164 number. Normalize using Google
[libphonenumber](https://github.com/google/libphonenumber), requiring an
international `+` number and using default region `ZZ` (no inferred country).
Reject extensions and invalid numbers. Use the same metadata version across
clients and use the stored canonical number for dedupe. Contact display name is excluded from
deduplication. Never equate epoch-spanning tags.

## 5. DNS filtering

ppdns is the recipient of its own HPKE configuration. An admin sends it
directly to the pinned ppdns HTTPS origin after obtaining authorization to
configure that ClientID. PWA CORS and a narrowly scoped, short-lived DNS
configuration grant are F9 requirements. The app API and its database do
not receive the policy copy. The wire is `{header,enc,ct}`, with
`header={v,clientId,revision,ppdnsKeyId}`. Here
`ppdnsKeyId` is SHA-256 of the pinned raw X25519 public key. Use base-mode
HPKE, `info=D("dns-config",header)`, empty AAD and JCS plaintext
`{allowDomains,blockDomains,blockedCategories}`. Each array is sorted,
duplicate-free and contains canonical values (ASCII lower-case DNS names
without a terminal root dot, or known category identifiers). ppdns MUST route
only to the grant-bound pseudonymous ClientID. Initialize at revision 1
and require the exact successor via atomic compare-and-swap. Only an
identical retry can reuse a revision. To recover an exhausted counter or
a hostile revision history, provision a fresh ClientID and bind it in the
next signed R snapshot. Never reset a revision for an existing ClientID.
Drop transport payloads from logs. This endpoint uses API authorization. HPKE base
mode supplies no sender authentication. The DNS operator or a compromised
control plane can still alter the DNS filter. The phone's signed R policy
binds the intended ClientID, revision and
`SHA-256(D("dns-policy",policy))` over the canonical DNS plaintext above.
After publishing and periodically thereafter, the phone requests the live
configuration digest from the pinned ppdns origin with a fresh challenge.
The endpoint must read back the effective per-client configuration from
the resolver, including inherited settings that alter enforcement. F9
defines how that effective policy maps to the canonical arrays. Compare
the returned challenge, ClientID, revision and digest against the request
and applied R snapshot. A mismatch, missing or unverifiable response
marks DNS protection unverified (`lockIntact:false`) and is reported in R.
The digest comparison detects drift when the readback is honest. A
malicious resolver that reports the intended digest while serving
different answers can evade this check.

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
| PWA | WebCrypto for randomness, SHA-256, HMAC, HKDF, AES-GCM, and native X25519 or Ed25519 when usable, with strict profile verification for every signature backend. Persist the complete X25519 key pair and pass both keys to HPKE decapsulation so it need not export the private key. `@hpke/core` **1.10.1** (MIT) for HPKE. On browsers lacking native X25519 use `@hpke/dhkem-x25519` **1.8.1** (MIT, noble-based, with `@hpke/common` **1.13.0**). For missing Ed25519 use `@noble/curves` **2.4.0** and its `@noble/hashes` **2.4.0** dependency (MIT). Keep native keys non-exportable in IndexedDB. Store software private bytes encrypted with a non-exportable, local WebCrypto AES-GCM storage key | hpke-js is maintained by Ajitomi Daisuke, with November 2026 releases, RFC 9180 and Wycheproof coverage. Upstream explicitly reports no formal audit. Noble is maintained by Paul Miller, with the 2.4.0 releases in August 2026. Its upstream review history describes scoped reviews and subsequent changes. No exact-release audit is assumed. [HPKE project](https://github.com/dajiaji/hpke-js) · [noble-curves](https://github.com/paulmillr/noble-curves) · [noble-hashes](https://github.com/paulmillr/noble-hashes) |
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
F1 is gated on a required JVM CI job consuming both checked-in JSON files
using the selected JVM/Android backends, with the same positive and negative
expectations as TypeScript. F1 must also run real-device tests at the browser and Android support floor and
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
