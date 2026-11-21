# Deleting accounts, phones and old data

What the server deletes, when, and what a phone sees. The privacy policy on
plainphone.org (`site/content/*.mjs`) and [privacy.md](privacy.md) describe the
same rules in plain words; change them together.

## Removing a phone

`DELETE /api/phones/{pid}` (the "Remove this phone" button on the phone's page).

- On a Child phone it applies at once. On a Self phone it is a loosening change and
  waits for the key (otherwise the owner could remove the phone and pair it again as a
  Child, which has no key).
- The phone row is deleted, and with it every app, contact, schedule, filter setting,
  position, key and pending change of that phone (foreign keys cascade).
- In the same transaction its DNS ClientID is written to `dns_deletions`. The server
  asks the DNS service to delete it right away; if that fails, the sweeper retries
  every minute until the DNS service answers 2xx or 404. The table holds only the random
  ClientID.
- The phone's next request gets `401`. It keeps its last rules, stops polling and points
  DNS back at the host from its QR code ([phone-sync.md](phone-sync.md)). The lock stays
  on; only a new setup removes it.

Renaming is `PATCH /api/phones/{pid}` with `{ "name": "…" }` and applies at once on any
profile (a name is not a rule).

## Deleting an account

`DELETE /api/me` with `{ "confirmEmail": "<own address>" }` (Settings → Delete my account).

| Situation | What happens |
|---|---|
| A household you share with another parent | It stays, with all its phones. You leave it. If you were the owner, the longest-standing other member becomes the owner. The phones keep working. |
| A household where you are the only member, with Child phones | The household is deleted with all its phones, as if each phone was removed (DNS deletion included). Each phone gets `401` on its next poll and falls back as above. |
| A household where you are the only member, with a Self phone | Refused with `409` and the ids of those phones. Remove them first; that goes through their key (at most 72 hours with the delay key). Deleting the account must not be a way around the key. |
| You are someone's trusted person | Their key becomes the delay key (with their delay hours), and requests that waited for you start the delay from now. |
| Invitations sent to your address, your login links | Deleted. |
| A waiting key change that would make you someone's trusted person | Cancelled, so your address is not kept in it and cannot be linked to a new account later. |
| Changes you requested or decided on other phones | Kept, with `requestedBy`/`decidedBy` set to null. |

The session cookie is cleared. Signing in again with the same address creates a new,
empty account.

## Cleaned up by the sweeper (every minute)

| Data | Deleted |
|---|---|
| Login links | 1 day after they expire (15 minutes) |
| Sessions | When they expire (60 days) |
| Pairings | 1 day after they expire or were created |
| Household invitations | When accepted (at once), or 1 day after they expire (7 days) |
| Finished pending changes (applied, cancelled, rejected, failed) | 30 days after they were decided. Their `op` can hold contact names and numbers, domains or an email address |
| DNS ClientIDs of removed phones | As soon as the DNS service confirms. Retries back off (2, 4, 8 … minutes, at most an hour), and a pass stops at the first failure so a DNS outage cannot hold up the rest |

The sweeper logs one line with counts when it deleted something, and always on its first
pass after start, for example
`sweeper: applied=0 dnsSynced=0 dnsDeleted=0 deleted magicLinks=1 sessions=0 pairings=0 invites=0 changes=0`.
It never logs ids, addresses or names, and a failed DNS delete is logged without its ClientID.

Billing is switched off ([billing.md](billing.md)). When it is on: a household's subscriptions
(`billing_subscriptions`) are deleted with the household, and deleting an account that is the only
member of a paying household cancels the subscription at Stripe or Google Play. Paid early unlocks
(`early_unlocks`) are purchase records that bookkeeping law requires us to keep, so they stay after
the phone, household or account is deleted, with those links set to null. They hold amounts, times
and the provider's references, never a name, an address or card data.

Database backups still hold deleted data until they rotate out (30 days on the hosted
service).
