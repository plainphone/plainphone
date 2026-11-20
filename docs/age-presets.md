# Age presets and the review date

Freedom should grow with the child. A preset gives the rules a sensible starting point for an age,
and a review date brings the parents back to look at them again and open more. The long-term goal
the parents see is that the phone is released one day ([design principle 6](design-principles.md)).

Everything here is optional and can be switched off. A preset only fills in values the parents can
change afterwards; it never locks anything. Phones that existed before this feature have no preset
and no review reminder until a parent turns it on. It is for **Child** phones only: a Myself phone
has no parents to remind.

## The presets

One table, `server/src/lib/age-presets.ts`, is the single source. Setup in the dashboard and the
parent app reads it from `GET /api/age-presets`, so what a preset says before it is chosen is exactly
what it sets. [Modes](policies.md) can reuse the same table later.

| Preset | Time a day (weekday / weekend) | Bedtime | School time (Mon to Fri) | Web filter blocks |
|---|---|---|---|---|
| 8 to 9 years | 1 h / 1 h 30 min | 19:30 to 07:00 | 08:00 to 14:30 | social media, adult content, gambling, dating, video |
| 10 to 11 years | 1 h 30 min / 2 h | 20:30 to 07:00 | 08:00 to 14:30 | social media, adult content, gambling, dating |
| 12 to 13 years | 2 h / 2 h 30 min | 21:00 to 07:00 | 08:00 to 14:30 | adult content, gambling, dating |
| 14 and older | 2 h 30 min / 3 h | 22:00 to 07:00 | none | adult content, gambling |

These are starting points, not claims about what is right for a child. Each family changes them.
Every step up lets the child do more: the table is tested to never block more for an older age.

Applying a preset (`POST /api/phones/{pid}/age-preset`) goes through the same changes as any rule
edit, so the rules revision, the phone's wake-up and the weekly summary behave as usual:

- the **daily cap** (all apps together) becomes the weekday minutes, with the weekend minutes on
  Saturday and Sunday;
- the **bedtime** window (every day) and the **school time** window (Monday to Friday) are updated
  in place, or created, or (school time at 14+) removed. The apps allowed during a window are kept;
- the **web filter** blocks exactly the preset's categories and opens the others.

Per-app limits, contacts, the app list, location and the phone's own settings are not touched.
Applying counts as a review and restarts the review clock. The setup and "Growing up" pages say what
will be set before anything is changed.

## The review date

| Setting | Default |
|---|---|
| Remind me to review the rules | on for Child phones added in setup (dashboard, and parent app by code or strong setup), off for phones that existed before |
| How often | every 3 months (1, 2, 3, 6 or 12) |
| Next review | one interval after the reminder was switched on (09:00 on the phone's clock), movable to any later date |

Dates are calendar months on the phone's wall clock: 31 January plus one month is 28 February (29 in
a leap year), and 09:00 stays 09:00 across a daylight-saving change.

When the date comes, the sweeper sends one calm reminder, by the parent's own channels: the household's
**By email** and **By notification** switches from the [weekly summary](weekly-summary.md) settings. If
both are off, the dashboard and the parent app still show a "Time to review the rules" note on the
phone's page. One date is reminded once (the date that was reminded is claimed before sending, so a
restart or a second server cannot repeat it). A phone that is being released gets no reminder.

The reminder, the mail and the "Growing up" page all give **two or three concrete ideas for what to
open next**, derived from the current rules and the next preset after the phone's own (or the first
preset that gives more time than today, when the phone has none): more daily time, a later bedtime, a
web filter category to open, or taking school time off. It only ever suggests something looser than
today. When there is nothing more to open, it says so and suggests talking about what the child would
like to try. A short line says that the goal is a phone that is released one day, with a link to the
existing release in the phone's "Manage" section.

"We have looked at the rules" moves the next review one interval ahead.

## API

| Route | What |
|---|---|
| `GET /api/age-presets` | The table above |
| `GET /api/phones/{pid}/age` | `{ agePreset, review: { enabled, intervalMonths, dueAt, due, suggestions } }` |
| `POST /api/phones/{pid}/age-preset` | `{ preset }`: apply a preset |
| `PUT /api/phones/{pid}/review` | `enabled`, `intervalMonths`, `dueDate` (a local date, today or later) |
| `POST /api/phones/{pid}/review/done` | We looked at the rules |

The phone summary (`GET /api/phones`) also carries `agePreset`, `reviewEnabled`, `reviewIntervalMonths`,
`reviewDueAt` and `reviewDue`. A phone from another household answers 404 on every route, and so does a
Myself phone.

## Where it is in the apps

- **Setup** (dashboard and parent app), for Child phones: an optional "How old is {name}?" step with the
  four ages, "No preset" and the review switch (on, every 3 months), then the optional
  [family agreement](family-agreement.md) step. What is chosen is saved on the phone as soon as it
  exists; if something cannot be saved, the setup says so and still shows the code.
- **Growing up** on the phone's page, in the rules list: change the age, the reminder and its date.

## Evidence

See [the evidence review](evidence.md#by-feature), "Growing independence". In short: rights guidance
(UN CRC General Comment 25, ¶¶19 and 85, evolving capacities; DSA minors guidelines ¶57(f)) supports
reviewing rules and widening a child's choices as they grow, and research on autonomy-supportive
mediation supports explaining and adjusting rules together. No study shows that age presets or
reminders improve outcomes; the presets are defaults a family overrides, and the table says so.
