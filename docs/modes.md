# Modes and contact groups

A **mode** is a named pack of rules: which apps can be used and which contact groups can call and text.
The parent makes a few (School, Homework, Free, Night) and puts them on **one weekly schedule**. The
phone switches between them on its own, also offline, and the home screen says which mode it is in.

Contacts sit in one of three fixed **contact groups**: Family, Friends and Others. A mode says which
groups are open, so homework time can allow Family only.

| Switch | Default | Where | What it does |
|---|---|---|---|
| **Modes** (`modesEnabled`) | off | Dashboard and parent app: the phone's Modes page (child phones only) | Replaces school time and bedtime with modes on one weekly schedule |

With the switch off, nothing changes: school time, bedtime, open mode and time limits work exactly as
before, and contact groups have no effect on the phone. Contact groups can be set either way.

## Why

Parents already think in parts of the day ("at school", "homework", "bedtime"), and families that agree
rules together keep them better ([design principle 4](design-principles.md)). One schedule with named
modes is easier to read for the parent and for the child than separate lists that overlap. Showing the
mode on the home screen keeps the rule visible to the child ([principle 1](design-principles.md)).
Contact groups let a family keep calls to people the child knows during school without closing the
door to the parents ([principle 3](design-principles.md)). Evidence: no direct evidence that modes
change outcomes; the reason is transparency and fewer, clearer rules. Children ask for family
technology rules that are clear and applied consistently ([Hiniker et al. 2016](https://doi.org/10.1145/2818048.2819940)).

## The model

```
mode        id, phone, preset, name, allApps, allowedPackages, contactGroups, quiet, isDefault
mode_slot   id, phone, mode, days, startMinute, endMinute
contacts    + contactGroup  (family | friends | others)
phones      + modesEnabled
```

- **preset** is `school`, `homework`, `free`, `night` or `custom`. It picks the icon and the
  translated name when `name` is empty, so a mode called "School" reads "Skole" on a Danish phone.
- **allApps**: the mode allows every app the parent allows anyway. Otherwise only `allowedPackages`
  (and the core apps, phone and messages) can be used, like a school time window today.
- **contactGroups**: the groups that can call and text during the mode. An empty list leaves only the
  parents, 112 and help lines.
- **quiet**: the mode is a bedtime. The phone is silent ([silent bedtime](bedtime.md)) while it is on.
- **isDefault**: exactly one mode per phone, "Free". It applies whenever no slot does. Its rules are
  the phone's normal rules (all allowed apps, every group, not quiet); only its name can change, and it
  cannot be deleted or put on the schedule.
- A **slot** has the shape of a school time window: ISO days (1 = Monday), start and end in minutes after
  local midnight, crossing midnight when `end < start`. Slots of one phone may not overlap: the API
  answers `400` with `overlap`. A slot cannot use the default mode.

Migration `0049_modes` is additive: two new tables, `phones.modes_enabled` (default false) and
`contacts.contact_group` (default `others`). It sets `contact_group = 'family'` on contacts that are
marked as parents. Existing columns are not changed.

## Contact groups

Every approved contact is in exactly one group. New and existing contacts start in **Others**. The
parents (the contacts marked to get an SOS) are always **Family**: marking a contact as a parent moves it
to Family, the API refuses to move a parent out of it (`400`), and the rules document sends `family`
for them whatever the stored value is.

Groups only matter while a mode is on and the approved list is enforced (strong mode, or light mode
with "Only approved contacts can call and text"). On a light phone with that setting off, everyone can
call during every mode, as before.

## How a mode becomes rules on the phone

The server sends two things in `GET /device/rules`:

1. `schedules`, the list every phone already understands. With modes on, it is built from the slots
   instead of the school time and bedtime table: each slot of a mode that limits apps or is quiet
   becomes one window, `kind: "bedtime"` for a quiet mode and `"school"` otherwise, with the mode's
   apps as `allowedPackages`. A quiet mode that allows every app sends the phone's allowed apps as
   the list. Slots of a mode that allows every app and is not quiet send no window.
2. `modes`, only while the switch is on:

```json
"modes": {
  "enabled": true,
  "defaultModeId": "…",
  "list": [{ "id": "…", "preset": "school", "name": null, "allApps": false,
             "allowedPackages": ["…"], "contactGroups": ["family"], "quiet": false }],
  "slots": [{ "id": "…", "modeId": "…", "days": [1,2,3,4,5], "start": "08:00", "end": "14:00" }]
}
```

and each contact carries `group`.

A phone that knows modes keeps using `schedules` for apps and silence, exactly as before, so there is
one code path for "which apps" and "is it quiet". From `modes` it takes the name to show and the contact
groups. It works out the current mode from the slots with the device clock, in the phone's time zone
and in wall-clock time, so a slot from 21:00 to 07:00 starts and ends at those times also on the nights
the clocks change, and it keeps switching when it is offline. The next start or end of a slot is added
to the alarm the phone already sets for school time and bedtime.

## Turning modes on and off

The first time a parent turns modes on, the server makes the modes from what the phone already has, so
nothing changes for the child until the parent edits something:

- **Free**, the default.
- Each school time window becomes a slot of a **School** mode, and each bedtime window a slot of a
  quiet **Night** mode. Windows with a different app list get a mode of their own. These modes keep
  every contact group open, because that is what school time and bedtime do today.
- If the phone had no school time, an empty **School** mode (Family only) is added; with no bedtime an
  empty quiet **Night** mode (Family only); and always a **Homework** mode (Family and Friends). They
  have no slots, so they do nothing until the parent puts them on the schedule.

Turning modes off brings back the school time and bedtime the phone had before; the modes are kept for
the next time. Turning them on again does not make them again.

## Conflicts

- **Overlapping slots** cannot be saved. If a phone still gets two at once (from windows that already
  overlapped before modes), the stricter wins for each part: only the apps both allow, only the groups
  both allow, and quiet if either is quiet. The home screen names the quiet one, or else the one that
  ends last.
- **Bedtime silence still wins.** A quiet mode is a bedtime: "Silent bedtime" decides whether it is
  silent, and parents, 112 and help lines ring as at bedtime.
- **Time limits** keep counting in every mode. A mode cannot give an app time the daily cap took away,
  and time cannot open an app the mode hides.
- **Requests.** "Ask for more time" and approving on the phone with the PIN work in every mode. An
  approved app or extra time takes effect at once, but an app the current mode does not allow stays
  closed until the mode ends, the same as during school time today.
- **Open mode** is overruled by a mode that lists apps, as by school time today.

## Always reachable

Modes cannot block help ([always-reachable.md](always-reachable.md)):

- 112, the local emergency numbers, help lines and the emergency call-back are decided before the
  contact list, so a mode cannot touch them.
- The parents are always Family and Family is never needed to reach them: the phone keeps every parent
  on the list in every mode, even when a mode allows no group at all.
- **No parents marked.** If no contact is marked as a parent, the phone cannot tell who the parents
  are, so contact groups do not narrow the list at all (the same rule as silent bedtime). The Modes page
  says so and links to Contacts.
- The phone app, messages and the other core apps stay usable in every mode.

`AlwaysReachableTest` puts a mode that allows no group and no app on the schedule all day, and the
server test does the same with the `modes_enabled` column flipped by the schema walk.

## Older phone apps

A phone app from before modes ignores `modes` and the contacts' `group`. It applies the `schedules`
built from the slots, so apps and bedtime silence follow the modes exactly. It does not narrow calls
and texts to the mode's groups: every approved contact can call, which is looser, never stricter. It
shows "School time" or "Bedtime" instead of the mode's name. Update the phone app to get both.

## On the phone

- The home screen shows the mode under the date, *School until 14:00*, with the quiet line at bedtime.
  The default mode shows nothing, like a phone without schedules.
- "What can my parents see?" lists the current mode and which groups can call.
- A call or text that a mode blocks is treated like a number that is not on the list: no ring, and it
  goes to the blocked log (number and time only).

## API

| Call | What |
|---|---|
| `PATCH /api/phones/{pid}` `{ "modesEnabled": true }` | The switch. `409` on a Self phone. Turning it on the first time makes the modes |
| `GET /api/phones/{pid}/modes` | `{ enabled, parentsMarked, modes, slots, current }`; `current` is the mode and when it ends, in the phone's time zone |
| `POST /api/phones/{pid}/modes` | A new mode: `{ preset, name?, allApps, allowedPackages, contactGroups, quiet }` |
| `PUT /api/phones/{pid}/modes/{mid}` | Change a mode. The default mode takes only `name` |
| `DELETE /api/phones/{pid}/modes/{mid}` | Delete a mode and its slots. `409` for the default mode |
| `PUT /api/phones/{pid}/mode-schedule` | Replace the weekly schedule: `{ slots: [{ modeId, days, startMinute, endMinute }] }`. `400` for an overlap or the default mode |
| `PATCH /api/phones/{pid}/contacts/{cid}` `{ "group": "friends" }` | Move a contact. `400` for a parent outside Family |
| `GET /api/phones/{pid}/contacts` | Each contact now has `group` |

Every write advances the rules revision and wakes the phone. Modes are only for child phones: on a Self
phone the routes answer `404`, because a Self phone's rules wait for the key and modes do not go through
that yet.

## Not covered

- Self phones keep school time and bedtime.
- Custom contact groups. The three groups are fixed.
- Moving a phone to another server does not carry modes or contact groups yet. The phone only moves to
  a server that sends the same protection rules, so with modes on it stays on the old server. Turn modes
  off first, move, and set them up again.
- A mode cannot change the web filter or the time limits.
