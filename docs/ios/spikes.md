# iPhone spikes

Five questions from the iOS research (#163) that only a real iPhone can answer. Each spike is
throw-away code: build the smallest thing that answers the question, write the result into
issue #163, and delete the code. The answers decide details of phases 1-5 in
[architecture.md](architecture.md).

## What you need

- A Mac with Xcode 26 and the Plainphone team (`P7698GU4AV`) signed in.
- A test child iPhone on iOS 26, signed in with a child Apple Account (under 18) in a Family Sharing
  group, and a parent iPhone or iPad on iOS 26 in the same group. Use a test family, never a real
  child's account or data.
- For (a): a second test child Apple Account and device in the same family, for the two-children
  case.
- Development signing is enough: Family Controls works in development builds without Apple's
  distribution approval. Register both devices under **Certificates, Identifiers & Profiles →
  Devices**.
- A throw-away Xcode project per spike (SwiftUI app plus the extension it needs), not the Expo app.
  A local Plainphone server (`pnpm dev:server`) reachable from the phones, for (a) and (d).

The phase 1 skeleton marks the code that waits for each answer with `TODO(spike a)` to
`TODO(spike e)` (table in [ios/README.md](../../ios/README.md)). Its dev host app (`PlainphoneDev`)
runs the real Swift module on a test iPhone, which helps once a spike has answered its question.

Write down for every run: device model, iOS version, date, and what you saw. Screenshots go into the
issue, not the repo.

## (a) Token round trip, parent iPhone to child iPhone

**Question:** can the parent pick the child's apps on the parent's own iPhone, send the selection
through the Plainphone server, and have the child's iPhone shield exactly those apps? Which child
does a token belong to when there are two?

**Build:**
1. App with Family Controls. On the child iPhone: `requestAuthorization(for: .child)` (the parent
   approves on the child's phone).
2. On the parent iPhone: `FamilyActivityPicker`, then `JSONEncoder().encode(selection)` and POST
   the bytes to a test endpoint (any small HTTP server, or a temporary route on a local Plainphone
   server).
3. On the child iPhone: GET the bytes, decode `FamilyActivitySelection`, set
   `ManagedSettingsStore().shield.applications = selection.applicationTokens`.
4. Repeat with two children: pick apps for child A only, apply on child B too.

**Observe:** whether the picker on the parent device lists the child's apps; whether decoding
succeeds on the child; whether exactly the picked apps are shielded; with two children, whether
child A's tokens do anything on child B; whether `TokenExpiryMessage` fires during a week.

**Decides:**
- Works for one child: phase 1 uses parent-side picking (`PUT /phones/{id}/ios-selection`).
- Fails: phase 1 picks on the child phone after the parent PIN (`PUT /device/ios-selection`) only.
- Tokens are per child: the server stores selections per phone and the parent app picks per child.
  Tokens shared across children: one family-wide picker is allowed, but still store per phone.

## (b) Shield Action: network or open the app

**Question:** can the Shield Action extension send "Ask for more time" itself, or open Plainphone?

**Build:** a Shield Configuration with a secondary button "Ask for more time", and a Shield Action
extension that on that button tries, in turn: (1) `URLSession` POST to the test server, (2) writing a
flag to the App Group and posting a local notification, (3) returning `.defer` or `.close`.

**Observe:** whether the POST reaches the server (expected: blocked); whether the local
notification appears and opens the app on tap; whether the app sees the App Group flag on launch;
memory use of the extension in Xcode's debug gauge.

**Decides:**
- POST works: the extension sends the request itself (and the "more time" capability can move from
  `partial` to `yes`).
- Only the notification works: the request is sent by the app after the child taps the notification
  (the plan in [architecture.md](architecture.md)).
- Nothing works: "Ask for more time" moves to the app's own rules page, and the shield only says so.

## (c) Contacts while contact editing is locked

**Question:** can the app write the approved contacts into the child's Contacts while the parent has
turned on Screen Time's contact editing lock (Communication Limits → Manage contacts)?

**Build:** an app with Contacts access that creates, edits and deletes a contact with
`CNContactStore` / `CNSaveRequest`, run once with the lock off and once with it on.

**Observe:** whether each save succeeds or throws (note the `CNError` code); whether new contacts
appear in Phone and Messages; whether Communication Limits "Contacts only" then lets those numbers
call and text.

**Decides:**
- Writes work while locked: phase 5 syncs approved contacts into Contacts automatically.
- Writes fail while locked: phase 5's wizard asks the parent to add contacts on their own device
  through Screen Time (or unlock, sync, lock), and the dashboard says so.

## (d) Background push latency over 48 hours

**Question:** how long does a rule change take to reach a child iPhone that is not opened?

**Build:** an app that registers for remote notifications and `BGAppRefreshTask`, and on every
wake-up (silent push, refresh task, foreground) POSTs `{reason, receivedAt}` to the test server.
A script on the server sends one `content-available` push every 30 minutes for 48 hours and logs
when it was sent.

**Observe:** for each push, the delay until the phone reports, or that it never arrives; how many
refresh tasks run; the effect of Low Power Mode, the night, and a force quit (swipe the app away
once, halfway through).

**Decides:**
- What the dashboard tells parents about iPhone rule timing (for example "usually within N minutes,
  can take hours if the phone is not used").
- Whether phase 1 needs a visible nudge on the child phone ("Open Plainphone to get new rules") after
  a time without receipt.
- Whether "never looser on error" needs a time-based fallback in the monitor extension.

## (e) Declared Age Range: Communication Limits flag

**Question:** does `AgeRangeService` report `parentalControls.communicationLimits` reliably, so the
dashboard can confirm that Apple's Communication Limits are on?

**Build:** an app that calls `AgeRangeService.shared.requestAgeRange(ageGates:)` and prints the
returned parental controls, on the child iPhone. Toggle Communication Limits on the parent's device
between runs (on, off, on with "Contacts only").

**Observe:** whether the child is asked to share; what the response contains in each state; how long
after a change on the parent's device the response changes; what happens on an adult account.

**Decides:**
- Reliable: phase 5 reports `communicationLimits` in the phone status, and the dashboard shows
  "Apple's call limits are on" as a receipt.
- Delayed or unreliable: the wizard only guides, and the dashboard says it cannot check.
- Not available for this account type: the contacts line stays "Set it up with the guide" and no
  receipt is shown.
