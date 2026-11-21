# Emergency openings

A **Self** phone can allow itself a few emergency openings per month: open one blocked app for 15
minutes when you really need it, without waiting for your key. Each opening is counted, logged and
shown to the person you trust. It is a switch, **off** by default.

Everything here is about apps the rules block. Calls, texts, 112 and the parents' reachability are
never blocked, so they never need an opening ([always reachable](always-reachable.md)).

| Setting | Default | Meaning |
|---|---|---|
| **Emergency openings** (`enabled`) | off | The stop screen offers an opening while it is on |
| **Openings per month** (`allowance`) | 3 | 1 to 10. Each opening is 15 minutes (`minutes`, fixed) for one app |

Both are in the dashboard (the phone's **Key** page) and in the parent app (the key screen).

## Why

A hard lock with no way out invites workarounds, and a lock people resent gets removed. Research on
self-imposed limits finds that people accept commitment devices better when they have a small,
visible exception ([evidence](evidence.md)). Counting and showing every opening keeps the exception
honest: nobody is told off, the trusted person simply knows. The numbers (3 of 15 minutes) are a
starting point, not a finding.

## Changing the settings is a loosening

Switching openings on, or raising the allowance, goes through the key like any loosening: it waits
for the key's delay, or for the trusted person to approve ([Self keys](self-keys.md)). Switching them
off, or lowering the allowance, applies at once. The change is `emergency.set` in
`POST/PUT` terms (`PUT /phones/{pid}/emergency-openings`, `{ enabled, allowance }`, `200` applied or
`202` pending) and shows in the pending changes like every other op. While the allowance is off it is
worth nothing, so storing a bigger number while off applies at once and turning it on later is the
loosening. A Self phone that has not connected yet (a setup draft) takes the change at once.

Existing Self phones keep it **off** and keep their current key delay exactly.

## On the phone

The phone gets `selfEmergency` in `GET /device/rules`:
`{ "enabled": false, "allowance": 3, "minutes": 15, "used": { "month": "2026-11", "count": 0 } }`.
It is left out for Child phones. A missing field (an older server) means off.

- The stop screen of a blocked app (not allowed, or time used up) shows **Emergency opening** and how
  many are left this month. With none left it says so and offers nothing.
- Tapping it asks once ("Open Spotify for 15 minutes? 2 left this month. The person you trust will be
  told.") and then opens that one app. Nothing else is unblocked, and only one opening runs at a time.
- It works **offline**. The phone counts for itself and records each opening before it reports it.
- The 15 minutes use the phone's own clock, so a reboot or a wall-clock jump ends the opening early,
  never late.
- It works in **light mode** (the phone's calm stop screen). A strong-mode (Device Owner) phone hides
  blocked apps instead of stopping them, so there is nothing to open from: the dashboard says so and
  offers no switch there.

### The month

The allowance is per **calendar month in the phone's time zone**. The phone counts the openings of the
current month and takes the larger of its own count and the server's `used.count` for the same month,
so a cleared app or a reinstall cannot hand out a second allowance, and an offline opening is never
counted twice. The month changes at local midnight; daylight-saving changes do not move it (the month
is read from the zoned date, not from 30-day arithmetic).

## The report

`POST /device/emergency-openings` with `{ "id": "<uuid made on the phone>", "packageName": "…",
"openedAt": "<ISO instant>", "minutes": 15 }` answers `204`. The phone opens first and reports later, maybe
days later after being offline, so the server never refuses: not when the switch is off now, not when
the allowance is spent. It records the opening once per `id` (a retry changes nothing), counts it in the
month the phone says it happened, and tells the trusted person. Only a malformed body is a `400`. A time
more than a day in the future is not believed and becomes "now". Phone-side retries are safe.

## Who sees it

- **The trusted person** gets a push ("Alma's phone: emergency opening. Spotify was opened for 15
  minutes. 1 of 3 used this month.") the first time an opening is reported, and sees the switch, this
  month's count and the ten latest openings under **People I help** (`GET /people-i-help`,
  `emergency`). No push is sent when the key is a plain delay (there is nobody to tell), and a muted
  phone sends none. Every report is recorded, but past 20 reports an hour for one phone the trusted person is no longer pinged for each one.
- **The owner** sees the same history on the Key page: `GET /phones/{pid}/emergency-openings` gives the
  switch, the allowance, the month's use and the openings of the last 90 days. Rows older than that are
  not shown.

Household isolation: only members of the phone's household and the person holding its key can read any
of this; the report only works with that phone's own token, and one phone's openings never count for
another.

## Moving to another server

A server move carries the key but not these settings: the new server starts with openings **off** and
the allowance 3. That can only tighten, and the owner can switch them on again through the key.

## Evidence

Evidence: no direct evidence for a monthly allowance, reason: commitment-device studies find hard locks
frustrating and give a reason to keep a small, visible, logged exception ([Allcott et al. 2022][commitment],
[GoalKeeper][goalkeeper], see [evidence.md](evidence.md)). It follows [design principle 12](design-principles.md):
no hidden monitoring, the person it concerns can see every opening.

[commitment]: https://doi.org/10.1257/aer.20210867
[goalkeeper]: https://doi.org/10.1145/3314403
