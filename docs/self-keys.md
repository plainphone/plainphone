# Myself setup and trusted keys

Choose **Myself** on Android and select a key before confirming setup. A wait-time
key takes 1, 6, 12, 24, 48 or 72 hours to loosen rules or release the phone.
Stricter rules take effect at the next connection. A trusted person can approve
loosening requests. Until the person joins, new requests use a 24-hour wait. When a QR helper
joins, requests made while waiting for that helper switch to trusted approval
if their wait has yet to expire.
Existing phones and older Android versions keep their established key or the
legacy 24-hour default.

## Undo setup

For a light-mode Myself phone, choose off, 5, 10, 30 or 60 minutes. A Child phone
defaults to 10 minutes, so a child cannot extend the time from their own phone.
An adult can set the same choices in the dashboard's phone settings before
pairing. This lets a family shorten the window or allow extra time to test the
setup. A dashboard choice takes precedence over the phone's choice. Completion
seals the original window. Edits cannot re-open it. Android measures elapsed
time across sleep. Rebooting closes the window. Undo works offline, and the
phone reports it when it reconnects. Device Owner mode uses its existing release flow.

## Help another person

Choose **A person I trust** and enter their email or choose a QR invitation.
The helper needs a separate household. If pairing rejects the email, correct
it on the phone or choose a QR invitation without starting setup again.
Once the phone connects, it or its dashboard can show a 15-minute invitation.
The friend scans it, signs in with a magic link if needed, and accepts in their
own account. A new QR replaces the previous one. The invitation grants helper
access only. They can find the phones they help and any requests under
**People I help**. On the owner's **Key** page, the owner can see who holds the
key. Two people can invite each other separately.

To end your outgoing key, choose **Wait time** and save. The request goes to
your current helper. The opposite direction of a mutual arrangement continues
until that person chooses to change their key. During upgrade, pending legacy
requests whose helper is ineligible move to the existing wait time, starting at
the upgrade.

On the phone's Today screen, **Ask for approval** lists the requested changes,
including the current and requested limit when it changes. Choose a request
to show its details and QR code. The helper can scan it from the dashboard,
the Plainphone parent app, or the phone camera. The helper reads the same
rule details before choosing Approve. If the rule changes in the meantime,
the helper must review the updated request. For a QR approval, the owner
shows a new code. Extra time applies on the day of approval in the phone's
time zone. If midnight passes between preview and approval, review the new
date before approving.

For contact requests, the owner sees the contact on their own phone. The
helper sees the action and a short request reference that also appears on the
owner's phone. The reference lets them confirm which request they mean while
keeping the contact's name and number private.

The code works for the person you chose, wherever they are, for 2 minutes.
It is meant for when you are together, but it cannot prove that. The helper
can approve from a forwarded image during that time. Showing a new code for
the same change replaces the old one, and each change can be approved once.

## Copy rules into a new setup

Show **Set up like me** from Today or the owner's dashboard. The invitee scans
the code to begin a Myself setup in their own dashboard. If they already opened
a light-mode setup link on Android, **Copy rules from a friend** replaces
the rule choices in that same draft after confirmation. The setup link remains
usable. The copied rules include time limits and weekday overrides, schedules,
app choices and blocked web categories. The recipient can edit those rules in
their dashboard before pairing. Contacts, locations,
domain exceptions, usage history and helper relationships stay with the original
account. The server deletes the shared snapshot after expiry and stores it with
no source-account identifier.

## Evidence

- Evidence: configurable undo and explicit wait time follow [design principle 12](design-principles.md). No direct evidence establishes these specific durations.
- Evidence: no direct evidence, reason: two-minute approval codes and single-use invitations make temporary, scoped collaboration possible.
- Evidence: no direct evidence, reason: reciprocal keys let adults choose mutual support and leave one direction independently.
- Evidence: no direct evidence, reason: copying a small set of rules reduces repeated setup work while giving each person a chance to edit the result.
