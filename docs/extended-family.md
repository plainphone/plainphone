# Extended family contacts and location snapshots

Two optional additions to the [family inbox](family-inbox.md), both off for every phone until a
parent turns them on:

- **Extended family contacts**: named people, such as a grandparent or an older sibling, who can
  swap short messages with the child. The parents invite them, the child has to say yes, and the
  person has to accept. The child can block them at any time.
- **Location snapshots**: the child can share where they are once, in one conversation, after
  confirming who gets it. Recipients can see it for one hour.

Neither adds free text from the child. The child sends the quick messages the parents approved,
as in the family inbox, and an extended contact answers with a short reply of up to 60 characters,
like a parent. Free text and media (photos, voice notes) wait for the encryption review (#120).

## Why

A child may want a private way to reach siblings or grandparents. Families that discuss privacy
together make better choices ([Wen et al. 2025](https://faculty.washington.edu/zkwen/articles/wen25supporting.pdf)),
but how an invitation should work for a child has not been tested. So the flow follows the
[research](research/family-comms.md#privacy-and-safety): approved, mutually accepted relationships
only, a roster the child can see, decline and block, and no caregiver rights for the new person.
A one-time snapshot can help with pickup. There is no direct evidence for snapshots in a product like
Plainphone, so they are an opt-in hypothesis built on the [location rules](location.md): one position,
an obvious notice, and a fixed end, following the EU guidelines on the protection of minors under
the Digital Services Act (point 81(d)) and standard 10 of the ICO Children's Code
([location evidence](location.md#evidence)).

## Switches

On a Child phone's page, in the **Family inbox** section of the dashboard and the parent app. Both
need the family inbox, sync through `/rules`, and show on the phone's **What can my parents see?**.

| Switch | Default | What it does |
|---|---|---|
| **Extended family contacts** (`extendedFamily`) | off | Named people the child approved can swap quick messages and short replies with the child |
| **Share a location snapshot** (`locationSnapshots`) | off | The child can send where they are once, to the people in one conversation, for one hour |

Turning extended family off (or the family inbox it needs) pauses every conversation: the roster
stays, the contacts' page says it is paused, their replies are refused and a position shared with a
contact is deleted. While paused, the rules still carry the roster with `enabled: false` (left out
only when nobody is on it), so the child keeps seeing who is on it, with a line saying it is paused,
and can still block someone. The parents still see the roster too and can remove people, but not
invite or send new links. Turning it on again resumes the conversations. Turning snapshots off
deletes a stored snapshot at once, as turning location off does.

## What an extended contact is

A person with a **magic-link web page**, not an account. We chose this over a lightweight account
because:

- grandparents and older siblings should not need a password or an app to receive "Pick me up";
- with no account there is nothing to recover, reset or escalate: the link's session only reaches
  the routes under `/api/family-contact`, and the parent API and the device API answer `401` to it;
- the session is tied to one conversation on one phone, so it cannot be used for another child,
  another household or the parents' dashboard.

An extended contact never gets caregiver privileges: they cannot see the rules, the location page,
the family inbox, other contacts or anything the child did before they joined. Parents see the
roster and each person's state, but **not** the messages between the child and that person, in line
with the research's "keep content with participants" and "no hidden copies". The server can read
them, as it can read the family inbox, and the child's phone and the contact's page say so.

## The invitation

1. A parent types the name the child knows the person by ("Grandma") and gets a **single-use link**,
   valid for 7 days. Only a hash of it is stored. The parent sends it to the person their own way.
2. The child's phone shows the invitation in **Family contacts**: "Your parents invited Grandma.
   Do you want to swap messages with Grandma?" with **Yes** and **No thanks**.
3. The person opens the link, sees whose invitation it is, and taps **Accept** or **No thanks**.
   Accepting uses up the link: the browser gets its own session token, and opening the link again
   finds nothing.

Steps 2 and 3 can happen in either order. The person becomes a member only when both have said yes.
Until then the contact's page says it is waiting for the child, and replies are refused.

| State | Meaning | On the child's roster |
|---|---|---|
| `waitingForChild` | The child has not answered | Yes, with Yes / No thanks |
| `waitingForContact` | The child said yes; the person has not accepted | Yes, "Waiting for Grandma" |
| `active` | Both said yes | Yes, with the conversation |
| `blocked` | The child blocked the person | Yes, "Blocked" |
| `declinedByChild`, `declinedByContact` | One side said no | No |
| `expired` | The link ran out before the person accepted | No |

A phone has at most ten extended contacts, not counting declined and expired invitations (a new
link for one of those counts it again, so it is refused when ten are already counted). Those stay
on the parents' list for 30 days so they can see what happened, then the sweeper deletes them.

## Roster changes the child can see

The roster comes with the rules, so the phone always shows the current one. The phone also keeps a
short local list of changes (only on the phone, never sent), shown under the roster: someone was
invited, joined, got a new link, was removed, left, or was blocked. A person never disappears
from the child's phone without a line saying so.

## Block, removal, a new link and leaving

- **Block** (the child, on the phone): the person's session and link stop working at once, a
  snapshot shared with them is deleted, and nothing they send reaches the phone. It works also while
  the feature is off. Only the parents can then remove the person, and a new invitation needs the
  child's yes again. The parents are not sent a notification about it; they see "Blocked" on the
  roster.
- **Remove** (a parent): deletes the person, their session, the conversation and any snapshot.
- **New link** (a parent): for a lost link, a new device or an expired invitation. The old session
  ends, the old conversation is deleted, and the child has to say yes again, because the new link
  may not be in the same hands. This is the only "account recovery" there is.
- **Leave** (the person, on their page): as if a parent removed them.

**Removal while the phone is offline.** When the phone is back, the new rules no longer list the
person: the phone adds a line to the change list, deletes its copy of the conversation and drops
what it had queued for them. If a queued message reaches the server before the phone has seen the
new rules, the server answers `gone: true`, because there is nobody to keep it for, and nothing is
stored.

## Conversations

Each active person has one conversation with the child, separate from the family inbox and from
every other person. On the phone they sit under **Family** in Messages.

- The child sends the approved quick messages (when **Quick messages** is on). No check-ins: "I'm
  home" is for the parents.
- The person replies with up to 60 characters, at most 20 an hour.
- States are honest and minimal: the child sees **Sending…**, **Sent** (on the server), **Delivered**
  (the person's page fetched it), or **Not delivered**. The person sees the same for replies. There
  are no read receipts, no typing, no last seen.
- A person's page checks for new messages every 30 seconds while it is open. It sends no
  notifications yet; the parent who invited them says when to look.
- 50 messages and 30 days per conversation, deleted with the person or the phone.

**Delivery and retry.** Like the family inbox: the phone gives each message an id, and a retry with
the same id never adds a second line. There is no SMS fallback, because Plainphone does not know
the person's number; the phone retries for a day and then says **Not delivered**. While the parents
have the feature switched off, messages wait on the phone. The child's **Yes**, **No thanks** and
**Block** show at once and reach the server on the next sync.

## Modes

A person is in the **Others** contact group until a parent puts them in another
([modes](modes.md#contact-groups)). With modes on and the approved list enforced, the child can send
to the person only while the current mode allows their group; the conversation says "Not during
School" otherwise. Their replies still arrive. Calls and SMS are not affected: an extended contact is
not a phone contact, and joining never moves a phone contact between groups. The parents, 112 and help
lines stay reachable in every mode ([always reachable](always-reachable.md)).

## Location snapshots

In the family conversation or a person's conversation, the child taps **Share where I am**. A
confirmation screen names exactly who will see it ("Mum and Dad" or "Grandma") and for how long
(one hour), with **Share** and **Cancel**. Only then does the phone look up one position, with the
same lookup as Find ([location](location.md#location-time-and-accuracy)), and send it.

- **One position, no history.** The server keeps one snapshot per phone. A new one replaces the
  old one, whoever it went to, and the sweeper deletes it when it expires.
- **Recipients only.** A snapshot to the parents shows in the family inbox, never to a contact. A
  snapshot to a person shows only on that person's page, never to the parents or on the location
  page. Find and the location page are not changed by snapshots. A snapshot has no SMS fallback,
  so in the parents' inbox one that reached no parent device by push reads **Sent**, never
  **Sent as SMS**.
- **Expiry.** One hour from when the child confirmed. After that the line stays in the conversation
  ("Shared a location") without the position.
- **The switch.** Off deletes a stored snapshot. A snapshot the phone sent before it heard the switch
  was off is still recorded as a line (the phone is the authority for what it did), but its position
  is not kept.
- **The child sees it.** Each snapshot adds a line to the phone's own location log on **What can my
  parents see?**: "You shared your location with Grandma at 16:40, until 17:40". A snapshot that
  never arrives (**Not sent**, or the person was gone) is taken off the log again, as nothing was
  shared.
- **Retry.** The phone retries a snapshot with the same id for at most one hour, so it never sends
  a position that would already have expired. After that it shows **Not sent**.
- **Location permission.** If the phone cannot get a position (permission denied in light mode,
  location off in the system settings, or no fix within 30 seconds), nothing is sent and the
  child is told why. In strong mode Plainphone holds the permission as device owner; in light mode
  the child or parent grants it.
- **Not ongoing.** There is no live sharing from a conversation; "always" stays a parent choice on
  the location page with its own end.

## Always reachable

None of this touches 112, help lines or the parents' reachability. The family inbox and the parents'
calls work the same whether extended contacts are on, off, paused or blocked.

## API

| Endpoint | Who | What |
|---|---|---|
| `PUT /phones/{pid}/sos` with `extendedFamily`, `locationSnapshots` | parent | The switches |
| `GET /phones/{pid}/extended` | parent | The roster, without messages |
| `POST /phones/{pid}/extended` `{ name }` | parent | Invite; returns the single-use link once |
| `POST /phones/{pid}/extended/{cid}/link` | parent | A new link; ends the old session and conversation |
| `PATCH /phones/{pid}/extended/{cid}` `{ group }` | parent | The contact group for modes |
| `DELETE /phones/{pid}/extended/{cid}` | parent | Remove |
| `POST /device/extended/{cid}/answer` `{ allow }` | phone | The child's yes or no |
| `POST /device/extended/{cid}/block` | phone | Block |
| `GET /device/extended/{cid}` | phone | The conversation |
| `POST /device/extended/{cid}/messages` `{ id, text, sentAt }` | phone | A quick message; `{ stored }` or `{ gone }` |
| `POST /device/extended/{cid}/received` `{ ids }` | phone | The device receipt for replies |
| `POST /device/location-snapshot` `{ id, to, lat, lon, accuracyM, recordedAt, sentAt }` | phone | A snapshot to `parents` or a contact id |
| `POST /family-contact/invite`, `/accept`, `/decline` `{ token }` | the person | Preview, accept (returns the session) or decline; 30 per 15 minutes per address |
| `GET /family-contact/me`, `DELETE /family-contact/me` | the person | The conversation, or leave |
| `POST /family-contact/me/messages` `{ text }` | the person | A short reply |

The rules carry two new blocks, each left out while off (`extended` comes with `enabled: false`
and the roster while paused with people on it):

```json
"extended": { "enabled": true, "quickMessages": true,
  "contacts": [{ "id": "…", "name": "Grandma", "status": "active", "group": "others", "rev": 3 }] },
"locationSnapshot": { "enabled": true, "minutes": 60 }
```

`rev` changes whenever the phone should fetch that conversation again (a reply, a receipt, a new
link). Older phone apps ignore both blocks.

Migration `0053_extended_family` is additive: three new tables (`extended_contacts`,
`extended_messages`, `location_snapshots`) and two phone columns, both default false.

## Not covered

- Notifications to a person's device. Their page polls while open.
- Voice notes and photos (#122, the media half): they wait for encrypted attachments.
- Group conversations with several people. Each person has their own conversation.
- Unblocking from the phone. A parent removes and invites again, and the child decides again.
- Moving a phone to another server does not carry extended contacts.
