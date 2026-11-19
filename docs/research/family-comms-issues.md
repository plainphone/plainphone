# Family communication issue drafts

The orchestrator can file these in order and replace draft numbers with issue links. Estimates are agent-days (S 1–4, M 5–9, L ranges that reach 10 days or more). See [research](family-comms.md) for the assumptions and sources. Each draft includes its own toggle and test requirements.

## Phase 1 — Carrier callback

### 1. Let a child ask a caregiver to call from SOS

**Size** S, 2–4 days. **Dependencies** SOS action surface and existing Web Push. Coordinate with #109's “Call me” template to keep one action. Native push can follow independently.

**Why** A child can use Wi-Fi to ask for help when placing a call themselves is inconvenient. The caregiver can respond through their normal dialer. Direct evidence for this exact button is unavailable. The practical coordination need is documented in the [parent–adolescent diary study](https://doi.org/10.1111/cdev.14203).

**What and acceptance criteria**

- Send a scoped, authenticated request to the enrolled caregiver with an idempotent identifier. Show queued, sent and expired distinctly. Expire within 24 hours, and suppress stale alerting while recording when an authenticated device says the action occurred.
- Use existing Web Push and dashboard fallback. Show a callback button that opens the normal dialer using the enrolled number after explicit tap. Keep the existing SOS and 112 actions reachable.
- Toggle “Ask for a callback” per phone in web and parent app, off by default. Explain “Let this phone ask a caregiver to call back.” Sync via `/rules` and show the state on the phone.

**Tests** API auth and household isolation, duplicate taps, offline expiry, settings sync, delayed report after disable, denied push and physical carrier handoff in Light and Strong, with synthetic numbers.

## Phase 2 — Private coordination

### 2. Bring approved quick messages and check-ins into a family inbox

**Size** M, 5–8 days. **Dependencies** SOS, #109 templates, suggestions and code semantics. Existing Web Push, with native push optional.

**Why** Preset requests and check-ins cover repeat family logistics with a short interaction. [Diary study](https://doi.org/10.1111/cdev.14203)

**What and acceptance criteria**

- Use one child–caregiver thread, named recipients, a short outbox, and delivery/device receipt state. Surface approved templates and a manual “I'm home” event without coordinates.
- Send code messages through the SOS path with original timestamp and rules for escalation/location. Reuse #109's approval flow. Disclose server readability of the bounded ordinary preset queue and keep code history in the SOS flow.
- Provide independent “Family inbox”, “Quick messages” and “Check-ins” toggles in web and parent app, all off, with one-line explanations, `/rules` sync and child-visible state. Disable dependent actions when the inbox is off. Keep SOS code behavior governed by its own SOS settings.

**Tests** Retry and offline delivery, replay and rule change, read/send isolation, disabled settings, quiet-hour ordinary notifications and urgent code behavior through SOS.

### 3. Verify an endpoint encryption design for Plainphone messages

**Size** M, 5–8 days. **Dependencies** Existing authentication and enrollment, draft 2 data model. No native push, SOS or #109 implementation dependency for the synthetic experiment.

**Why** Family members need clear boundaries for who can read messages, including when devices change. [Joint oversight study](https://doi.org/10.1145/3512904)

**What and acceptance criteria**

- Use synthetic fixtures to compare OpenMLS with a private Matrix SDK fallback for Kotlin and Expo Android/iOS. Document browser key handling feasibility separately, component licences, device identity binding, local storage, revocation, offline ordering, recovery and server metadata. Get independent security/privacy review before selecting the implementation.
- Record a recommendation with the concrete interoperability gaps and evidence. Require an explicit review outcome before enabling free text on a family device.
- No new user-facing switch for this experiment. Keep the existing inbox option separate and the future free-text toggle off until the implementation ships.

**Tests** Cross-platform encrypt/decrypt, substituted endpoint and stale roster, revoke then send, lost device, retry/reordering and ciphertext-only server/push inspection.

### 4. Add private caregiver text and lightweight reactions

**Size** L, 10–16 days. **Dependencies** Drafts 2 and 3, approved deployment privacy review. Notification delivery uses existing push paths and any native push that has landed.

**Why** Families use text for clarification and support beyond preset logistics. [Diary study](https://doi.org/10.1111/cdev.14203)

**What and acceptance criteria**

- Add short encrypted text to approved caregiver threads in Android and the parent app. Show participant devices and changes, require approved enrollment and rotate keys after revoke. Add a small built-in reaction/sticker set. Provide generic notification payloads, local deletion, bounded delivery and a clear history expiry.
- Require an explicit browser trust review before offering web decryption. Web settings and disclosure ship with the parent app controls.
- Add “Free text” and “Reactions and stickers” independently per phone, off, with one-line descriptions in both caregiver surfaces, `/rules` sync and visible child state.

**Tests** Real-device synthetic messages in both directions, late retries, tampered envelopes, role and recipient revocation, receipt semantics, expiry and settings propagation. Check screen reader labels and large text.

## Phase 3 — Media and trusted contacts

### 5. Add short voice notes and voluntary location snapshots

**Size** M, 6–9 days. **Dependencies** Draft 4, existing approved location policy and encryption, ordinary push. No new SOS or #109 dependency.

**Why** Voice can reduce typing and a one-time snapshot can help with pickup. Direct Plainphone evidence is unavailable. Treat these as opt-in hypotheses.

**What and acceptance criteria**

- Record with a visible timer and deliberate press, offer preview, discard and explicit send. Enforce proposed 60-second/1 MB caps. A snapshot requires explicit confirmation, shows recipients and expires separately. Avoid ongoing location sharing from chat.
- Encrypt attachments before upload. Bound quotas, remove expired and orphaned objects, and disclose local and recipient copy limits.
- Add separate “Voice notes” and “Share a location snapshot” per-phone toggles, off, with a one-line explanation on web and parent app, `/rules` and child disclosure.

**Tests** Mic/location denial, cancellation, caps, recipient isolation, retention and restore, transport retry and rule changes in Light and Strong.

### 6. Add private photo sharing with local safety protection

**Size** L, 10–16 days after a viable on-device model is identified, with the model and safety performance unverified. **Dependencies** Draft 4 and bounded attachment storage from draft 5, counsel-approved reporting policy. No new push, SOS or #109 dependency.

**Why** Photo exchange can keep routine family updates in one place. On-device protection can add friction at the point of sharing. [Apple Communication Safety pattern](https://support.apple.com/en-ie/105069)

**What and acceptance criteria**

- Re-encode locally, remove metadata, constrain dimensions and size, preview and encrypt. No forwards, remote classifiers, classification telemetry or automatic reports. Block flagged outgoing images and withhold incoming previews while protection is enabled, with a discreet choice to seek help. Provide a deletion/reporting flow that previews exactly what is shared.
- Add “Photos” off and “Sensitive photo protection” on when managed photos are enabled. Expose both separately with plain explanations in web and parent app, `/rules` sync and child-visible effects. Keep photos off until the safety review passes.

**Tests** Use lawful synthetic images to test metadata stripping, false positives, missed detection, performance, protection settings, quotas, orphan cleanup, recipient access and no outbound classifier traffic.

### 7. Extend messaging to named, mutually approved family contacts

**Size** M, 6–9 days for one-to-one threads. **Dependencies** Draft 4, enrollment/revocation review. No new SOS or #109 dependency. Ordinary push reused.

**Why** A child may want a private way to reach siblings or grandparents. Evidence supports family discussion of privacy, with the exact contact flow untested. [Privacy discussions study](https://faculty.washington.edu/zkwen/articles/wen25supporting.pdf)

**What and acceptance criteria**

- Invite only named contacts using a single-use invitation. Require child-visible approval and contact acceptance, show membership and changes, and allow the child to block a contact. An approved contact receives no caregiver privileges or prior conversation history.
- Add “Extended family contacts” off per phone with a one-line explanation in web and parent app, `/rules` sync and a visible roster. Media requires its independent settings plus contact eligibility.

**Tests** Accepted and rejected invites, replay, account recovery and role escalation, roster rotation, cross-household denial and removal while offline, with synthetic identities.

## Parallel option — Calls without mobile coverage

### 8. Pilot one-way Wi-Fi audio with a tap-to-answer invitation

**Size** L, 8–13 days including the proof. **Dependencies** SOS, existing Web Push and approved web-5 capacity for an eventual pilot. Native push and #109 are optional. Adult synthetic pilot first.

**Why** Carrier callback cannot connect where the child has Wi-Fi and no mobile service. Direct evidence for Plainphone's need or reliability is unavailable. Compare relay and success rates before expanding.

**What and acceptance criteria**

- Use self-hosted LiveKit with one child caller and designated parent browser receiver. The parent chooses to answer in foreground from an expiring Web Push invitation. Use short-lived single-room credentials, atomic cancel/answer, explicit microphone permissions and clear status. Document SFU trust and gate family use on privacy review. Budget endpoint-only encryption separately if required.
- Add “Call a caregiver over Wi-Fi” off with a one-line explanation in both caregiver surfaces, `/rules` sync and visible policy. Preserve SOS, carrier reachability and 112.

**Tests** Physical Android and browser, mixed networks, direct SFU connection and forced TURN, expired/revoked or raced acceptance, quiet hours, mobile interruptions, mic denial and accessibility. Measure outbound traffic, peak load and call outcomes on a synthetic setup.

### 9. Ring on parent phones for an incoming Wi-Fi call

**Size** L, 7–12 days incremental with push ready. Add 2–4 days if common native push infrastructure is missing. **Dependencies** Draft 8 and supported native delivery, Android FCM or a separately tested UnifiedPush path, iOS APNs VoIP PushKit and CallKit. SOS through draft 8. #109 optional.

**Why** A foreground invitation cannot be relied on for a locked phone. Native call affordances give an explicit accept or decline action. [Android Telecom](https://developer.android.com/develop/connectivity/telecom/voip-app/telecom) · [PushKit](https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit)

**What and acceptance criteria**

- Handle native cold start with a short-lived opaque invite. Deduplicate and surface cancellable ringing, and join media after explicit acceptance and authorization. Keep generic notifications and no idle call socket. Report delivery/ring and media connection separately.
- Add “Ring caregiver phones for Wi-Fi calls” off per originating phone in web and parent app with one-line explanation and `/rules` sync. Each receiving device also opts in and can decline. Respect quiet hours and OS settings.

**Tests** Physical devices across supported OS versions, locked/dozing/force-stopped, disabled notifications, delayed, duplicate and cancelled invites, Bluetooth, carrier interruptions, timeout, revocation and battery sampling.

### 10. Add inbound family calls and optional video in separate steps

**Size** L, 12–20 days, with inbound audio first and video reviewed separately. **Dependencies** Drafts 7–9, Android child wake path and endpoint media encryption/privacy review. SOS continues independently. #109 optional.

**Why** Approved families may want reciprocal calls or visual contact. Benchmark products expose video as separately controlled. [Gabb video](https://gabb.com/support/en/articles/11173730-gabb-messenger-safe-video-calling)

**What and acceptance criteria**

- First add incoming one-to-one audio on the child phone for approved mutually opted-in contacts. Then add optional video starting camera-off, with explicit preview and visible capture indicator. Enforce revocation, preserve confidential help and keep emergency arbitration.
- Provide separate per-phone “Receive family calls” and “Video calls” toggles, off with one-line descriptions in both caregiver surfaces, `/rules` sync and child-visible state.

**Tests** Both directions, locked child phone and Device Owner restrictions, allowlist/revoke, mic/camera denial, camera never starts on answer, bandwidth under loss, counterfeit/raced invitations and carrier conflict, with simulated emergency paths.
