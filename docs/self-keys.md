# Myself setup and trusted keys

Choose **Myself** on Android and select a key before confirming setup. A wait-time
key takes 1, 6, 12, 24, 48 or 72 hours to loosen rules or release the phone.
Stricter rules take effect at the next connection. A trusted person can approve
loosening requests. Until the person joins, new requests use a 24-hour wait. When a QR helper
joins, requests made while waiting for that helper switch to trusted approval
if their wait has yet to expire.
Existing phones and older Android versions keep their established key or the
legacy 24-hour default. You can edit a draft's rules, favourites and key in the
dashboard before connecting. The key selected on the phone during setup replaces
the draft key.

## Undo setup

For a light-mode Myself phone, choose off, 5, 10, 30 or 60 minutes. A Child phone
defaults to 10 minutes, so a child cannot extend the time from their own phone.
An adult can set the same choices in the dashboard's phone settings before
pairing. This lets a family shorten the window or allow extra time to test the
setup. The phone uses the dashboard choice if one was set when it connected.
The dashboard choice locks when the phone receives its connection token. For
Myself setups, the completion report records the window used on the phone.
Android measures elapsed time across sleep. Rebooting closes the window. Undo
works offline, and the phone retries its completion and undo reports when it
reconnects. The dashboard shows the end time when the phone can report it.
The server removes the phone and notifies the current household when it receives
the undo, including after a long offline period. If the recorded window ended
more than 48 hours earlier, the notice says the report arrived late. Device Owner mode uses its existing release flow.

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
While a QR invitation is waiting, the web **Key** page and the parent app say so and name the
fallback (changes wait for the key's delay, 24 hours by default); once it is accepted they say that instead. The parent app
can create the invitation link too. An invite is never an approval: on the phone the two codes
are labelled differently, and an expired invitation or approval code is reported as expired
with a button for a new one, rather than as an empty list.

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
the helper must review the updated request, even if the summary still looks
the same. The server checks a fingerprint of the requested operation and
the current rule before applying it. For a QR approval, the owner
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
The household check cannot catch a second account the owner controls outside
the household. The system also cannot prevent helpers from coordinating approvals.

## Copy rules into a new setup

Show **Set up like me** from Today or the owner's dashboard. The invitee scans
the code to begin a Myself setup in their own dashboard. If they already opened
a light-mode setup link on Android, **Copy rules from a friend** replaces
the rule choices in that same draft after confirmation. If a copied block
targets an essential app on the recipient's phone, the import summary shows
that the block was skipped. The setup link remains usable. Legacy blocks on Danish starter-pack apps are preserved. Other older
blocks must be set again before sharing because the stored app list does not
identify which denials were explicit. The template copies explicitly blocked
app package names, total and per-app time limits with weekday overrides,
schedules with their allowed app package names, and the web filter's blocked
categories.
The recipient can edit the rules before pairing. The allowed and installed app
inventory, app labels, contacts, locations, domain exceptions, usage history and
helper relationships stay with the original account. Each code works once and
expires after 15 minutes. The server stores the temporary snapshot without a
source-account identifier.

## Evidence

- Evidence: configurable undo and explicit wait time follow [design principle 12](design-principles.md). No direct evidence establishes these specific durations.
- Evidence: no direct evidence, reason: two-minute approval codes and single-use invitations make temporary, scoped collaboration possible.
- Evidence: no direct evidence, reason: reciprocal keys let adults choose mutual support and leave one direction independently.
- Evidence: no direct evidence, reason: copying a small set of rules reduces repeated setup work while giving each person a chance to edit the result.

## Private DNS with Tailscale or a work VPN

Myself light-mode setup asks whether you use another VPN. The choice on Android
replaces the dashboard draft when the phone first connects. Choose **Private DNS**
and follow [the Android setup instructions](light-mode.md#tailscale-and-work-vpns).
Tailscale needs **Use Tailscale DNS settings** off, which means MagicDNS names
will no longer resolve. Check status once your VPN is connected, especially if
work policies require a particular resolver.

After pairing, switching between **Plainphone VPN** and **Private DNS** in the
dashboard or parent app waits for your key. In Private DNS mode the Android
guard protects the Private DNS editor while leaving network settings open.
A confirmed loss of a previously working filter can reach your trusted person
by push and email. Setup after a method change and inconclusive DNS checks
remain visible in status without sending a protection alert.
