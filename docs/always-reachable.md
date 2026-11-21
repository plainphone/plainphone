# Always reachable

The rule behind [design principle 3](design-principles.md): in every mode and in every state, the phone
can reach **112 and the local emergency numbers, the parents, and the help lines**. It can call them,
they ring through, and the child can message them (SMS, and the [family inbox](family-inbox.md) where
it is on). Nothing a parent can switch on, no limit, no schedule and no update can take that away.
This is why 112 and the parents' reachability are the only things without a switch. The optional
[callback request](sos.md#asking-a-parent-to-call) on the SOS screen is an addition to calling the parents and
112, never a replacement: it sits below SOS and Call 112, and switching it off removes nothing the child could
do before.

| Group | Calls out | Rings in | Messages |
|---|---|---|---|
| 112 and local emergency numbers | always | the call-back from the emergency service rings for an hour (not after 114) | SMS to the number |
| Parents | always | always, also at silent bedtime | SMS, family inbox, quick messages |
| Help lines | always | replies ring inside their reply window | SMS where the line takes it |

Local emergency numbers (`EmergencyNumbers.LOCAL`): Denmark 112 and 114, Sweden 112, Norway 110, 112
and 113, Germany 110 and 112, UK 999 and 112, US 911. 112, 911 and 114 always work. The local numbers
come on top of Android's own list for the SIM, which can be empty without a SIM or with a foreign one.
They follow where the phone is (SIM, network, QR code country), not which language it speaks. When the
phone cannot tell where it is, every local number counts. A country it knows but that is not listed (Finland, say) adds none: Android's own list decides.

## When the rules cannot be read

The parents' numbers also have a second copy that does not depend on the rules: a small file in
device-protected storage, rewritten whenever the rules are put together (`ParentNumbers.kt`). If reading the
rules ever fails, outgoing calls go only to 112, the emergency numbers and that file, and a parent's SMS is
still delivered. Without the file (first boot, never synced) outgoing calls stay open. This is a failsafe, not
a feature, so it has no switch. Details and the tests: [contacts.md](contacts.md#when-the-rules-cannot-be-read),
`FailsafeTest`.

## The states

Strong and light mode, Child and Myself phones, open mode, school time, bedtime (silent or not), [modes](modes.md) (a mode that opens no contact group and no app, quiet or not), the
daily cap and app limits used up, "Ask for more time" pending, approval with the parent PIN on, an app
update window open, an app being installed, the phone released, and offline (the last rules keep
applying). The states that are only requests (more time pending, PIN approval pending) change no rule
the phone uses for calls, so they have no case of their own. The tripwire below only lists the fields of
`ContactRules`, `PolicyConfig` and `ServerOverlay`: a request state kept elsewhere (`SyncStore`, a request
queue) that one day blocks calls would not trip it, so such a state must be added as a real case.

## The tests

`android/app/src/test/java/org/plainphone/app/reachability/AlwaysReachableTest.kt` (Robolectric, runs
with `testDebugUnitTest`) and `server/test/always-reachable.test.ts` (runs with `pnpm -r test`).

They do not list the states by hand:

- **Android, calls and texts.** A rules document with everything on is stored, and then every boolean
  in it is flipped both ways, each schedule kind is switched on all day, caps are used up, and "all on"
  and "all off" are added. For each state the real `SyncedContactPolicySource` and `ContactPolicy`
  decide, in strong and light mode, for a Child and a Myself phone, and in every country in
  `EmergencyNumbers.LOCAL`: all emergency numbers, every parent (both directions, calls and texts, and
  that an incoming parent call rings at silent bedtime, the call-back from any number after an emergency call, and a help line replying to a call), and every number in the help line catalog
  (`server/catalog/helplines`). The family inbox must still be offered on a Child phone that is not released.
  Modes add states of their own: a mode on all day that opens no contact group (quiet or not), a parent
  whose stored group is Others, a parent missing from the list, no parents marked, and a broken modes block.
  A control checks that the mode really keeps an Others contact out, so these states are not vacuous.
- **Android, apps.** The worst app rules (school time that allows nothing, every app used up, open mode
  blocking everything, an update window holding every app back, an install window, all at once) are
  applied with `PolicyApplier` and `LightPlan`. The own app, the system dialer, the SMS app and the other
  core apps must never be hidden, suspended or blocked.
- **Server.** Every boolean column of `phones` is flipped both ways, every enum column takes every value,
  every nullable timestamp is set, every schedule kind runs all day and the caps are used up. After each,
  `GET /device/rules` must still carry every contact, the SOS parents and the family inbox. A new column is
  picked up by the next run. A phone that was released still gets its contacts, and an SOS it already sent
  by SMS is still recorded. With modes on and a mode that opens no group and no app all day, the rules
  still carry every contact and the parents, and a parent goes out as Family.
- **No date dependence.** An all-day window is `start == end`, which is on at every moment, so the tests give
  the same answer on any day.
- **It can fail.** A control test feeds a phone with the parents missing and expects violations, and the
  server test was checked against a rule that empties the contacts at bedtime.
- **Tripwire.** `ContactRules`, `PolicyConfig` and `ServerOverlay` have their field names listed in the
  test. Adding a field fails the test until the author has asked: can this stop a call, a text or the
  phone app? Then it goes into the states and into the list.

## Adding a rule

1. Put the new field in the maximal rules document (`maxRules()`) or in `hostileConfigs()` so it is exercised.
2. If it can block a number or an app, make the check fail first, then fix the rule, not the test.
3. Add the field to the tripwire list.
4. On the server, nothing to do for a new column: the schema walk covers it. A column that is the reachability
   feature's own switch (the family inbox switch) goes into `NOT_A_RULE_ON_REACHABILITY`, with a reason.

## What the first run found

- Light mode blocked the system dialer when school time or bedtime allowed nothing (strong mode already kept it).
- Strong mode could hide the phone app or the system dialer through the held-back list of an update window.
- 110, 113 and 999 were only emergency numbers when Android's list for the SIM said so.
