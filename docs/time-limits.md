# Time limits

A parent can cap how many minutes a day the phone's apps may be used: one cap for all
non-core apps together, and a cap per app. Core apps (phone, messages, maps, clock,
settings and the other apps the phone reports as `core`) never get a limit, so calls and
texts always work.

## The model

A **limit** is

```json
{ "minutes": 120, "days": { "6": 180, "7": 180 } }
```

`minutes` (0 to 1440) applies every day. `days` overrides it on ISO weekdays, `"1"` is Monday
and `"7"` is Sunday. A limit of 0 blocks the app for the day.

A **bonus** adds minutes to one local date, for one package or for the total (`"*"`). The
"+15 min today" button in the web dashboard and the parent app creates one. Both show the same
rule list (what and who, when, the phone) with a "Screen time" page next to "School time and
bedtime".

The limit for a date is `days[isoWeekday] ?? minutes`, plus the sum of that date's bonuses for
the same package. A day starts at local midnight in the phone's `timezone`.

A bonus also comes from the child asking: an approved request for more time is a bonus for that
app (or the daily cap) on the day of the request. The phone warns 5 minutes before time runs out
and the stop screen has an **Ask for more time** button. Both can be switched off per phone. See
[more-time.md](more-time.md).

## Where it is stored

| Table | What |
|---|---|
| `time_limits` | One row per phone and package; package `*` is the total cap |
| `time_bonuses` | One row per bonus: package, local date, minutes |

The rules document sends every limit and only the bonuses for today and tomorrow (phone time
zone, server clock), so the list stays short. Use is counted on the phone (usage access) and
reported as `timeUsed` in `PUT /device/status`; the server keeps only the latest report, and
the parent API shows it only when that report is from today in the phone's time zone.

## Parent API

| Route | What |
|---|---|
| `GET /phones/{pid}/time-limits` | `{ total, apps: [{ packageName, label, limit }], bonuses, used }` |
| `PUT /phones/{pid}/time-limits/total` | Set the total cap (body: a limit) |
| `DELETE /phones/{pid}/time-limits/total` | Remove it |
| `PUT /phones/{pid}/time-limits/apps/{package}` | Set an app's cap. `400` for a core app, `404` for an app the phone has not reported |
| `DELETE /phones/{pid}/time-limits/apps/{package}` | Remove it |
| `POST /phones/{pid}/time-limits/bonus` | `{ packageName: "*" or a package, minutes: 5 to 240 }`, for the day it takes effect in the phone's time zone. `400` when that target has no limit |

All writes go through the same change pipeline as other rules (`timeLimit.set`,
`timeLimit.bonus`), so the phone is woken at once.

## Self profile

On a Self phone, a change that gives more time waits for the key; one that gives less applies
at once:

- Adding a limit or lowering one: applies at once.
- Raising the minutes on any weekday, or removing a limit: waits for the key.
- A bonus: always waits for the key. It counts for the day it takes effect (the server picks
  the local date when it applies the change), so with the delay key it is extra time on a
  later day, not on the day it was asked for.

## On the home screen

Plainphone's home screen shows the minutes left today under each app that a cap applies to,
its own or the total, whichever is smaller, rounded up to whole minutes. An app shows "used
up" only at zero. Core apps never show a number. Without usage access the phone counts no
use, so the home screen shows no numbers at all rather than untouched caps.
