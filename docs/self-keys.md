# Myself setup and trusted keys

Choose **Myself** on Android and select a key before confirming setup. A wait-time
key takes 1, 6, 12, 24, 48 or 72 hours to loosen rules or release the phone.
Stricter rules take effect at the next connection. A trusted person can approve
loosening requests. Until the person joins, new requests use a 24-hour wait.
Existing phones and older Android versions keep their established key or the
legacy 24-hour default.

## Undo setup

For a light-mode Myself phone, choose off, 5, 10, 30 or 60 minutes. A Child phone
defaults to 10 minutes, so a child cannot extend the time from their own phone.
An adult can set the same choices in the dashboard's phone settings before
pairing. This lets a family shorten the window or allow extra time to test the
setup. A dashboard choice takes precedence over the phone's choice. Completion
seals the original window. Edits cannot re-open it. Android measures elapsed
time across sleep, and the server holds the deadline and authorizes the release.
After a reboot Android asks the server for the remaining time. Device Owner
mode uses its existing release flow.

## Help another person

Choose **A person I trust** and enter their email or choose a QR invitation.
Once the phone connects, it or its dashboard can show a 15-minute invitation.
The friend scans it, signs in with a magic link if needed, and accepts in their
own account. A new QR replaces the previous one. The invitation grants helper
access only. They can find the phones they help and any requests under
**People I help**. On the owner's **Key** page, the owner can see who holds the
key. Two people can invite each other separately.

To end your outgoing key, choose **Wait time** and save. The request goes to
your current helper. The opposite direction of a mutual arrangement continues
until that person chooses to change their key.

On the phone's Today screen, **Ask for approval** shows the pending trusted
requests. Choose a request and show the QR. The helper can scan it from the
dashboard on a browser with QR detection, in the Plainphone parent app, or
open it with the phone camera.
**Scan a Plainphone code** in the Android app opens the dashboard camera flow
in the browser. Review the named rule and approve as the signed-in helper.

The server signs each challenge for one phone and change, and validates its
two-minute deadline and current helper when approving. Applying the request
consumes the opportunity to use the code. The Android dialog blocks system
screenshots. A photo taken by a second camera can still be scanned by the
assigned helper before the code expires. Service restarts invalidate open
approval codes.

## Copy rules into a new setup

Show **Set up like me** from Today or the owner's dashboard. The invitee scans
the code and begins a new Myself setup in their own dashboard. Their draft
contains time limits and weekday overrides, schedules, app choices and blocked
web categories. They can edit those rules before pairing. Contacts, locations,
domain exceptions, usage history and helper relationships stay with the original
account. The server deletes the shared snapshot after expiry and stores it with
no source-account identifier.

## Evidence

- Evidence: configurable undo and explicit wait time follow [design principle 12](design-principles.md). No direct evidence establishes these specific durations.
- Evidence: no direct evidence, reason: two-minute approval codes and single-use invitations make temporary, scoped collaboration possible.
- Evidence: no direct evidence, reason: reciprocal keys let adults choose mutual support and leave one direction independently.
- Evidence: no direct evidence, reason: copying a small set of rules reduces repeated setup work while giving each person a chance to edit the result.
