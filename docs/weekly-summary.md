# Weekly summary

One calm summary per household and week, instead of a stream of alerts. It covers every
phone: screen time, requests, rule changes and protection news. Real-time alerts stay for
the things a parent must act on.

## What a summary holds

For each phone, for the seven days that end when the summary is due (screen time counts the seven
full days before the due day, because the due day itself is only partly over):

| Line | Where it comes from |
|---|---|
| Screen time per day (average over the days with a report) and the most used apps | The `timeUsed` the phone already reports in `PUT /device/status`. The server keeps the highest reading per phone, day and app, and nothing finer (no timeline). |
| Requests asked and answered | `phone_requests`, by when they were asked and when they were answered |
| Rule changes, counted by category (time limits, apps, contacts, web filter, schedules, other) | Recorded when a change is applied, at once or after its wait |
| Protection removed, phone out of contact, check-ins answered | Recorded when the event happens |

Only numbers and app names from the phone's own list are stored. There is no free text, no
contact names and no positions. The summary is shown with neutral wording and no scores or
streaks.

Screen time is reported by the phone only when it has a time limit (it counts use to enforce
the limit). A phone without limits shows "No screen time reported". Use is kept for 21 days, summaries
for 8 weeks.

"Ask for more time" requests have their own table (docs/more-time.md) and are counted in the
requests line (as kind `time`).

## When it is sent

The parent picks a day and time. The default is Sunday 18:00 in the household's time zone
(default Europe/Copenhagen; the dashboard offers the device's zone). The time is wall-clock time:
across a daylight-saving change the week is 167 or 169 hours long, and the summary still arrives
at 18:00.

- The sweeper builds the summary when the time arrives. A summary missed for more than three
  days (server down) is skipped.
- A household younger than two days waits for the next one.
- One row per household and week is the idempotency key. Delivery is claimed before it is
  sent, so a restart can skip a delivery but never repeat one. The summary stays on the
  summary page either way.
- Moving the day never gives two summaries within five days of each other.

## Delivery

- **Mail** in the shared brand layout (light and dark, text version) in the parent's language.
- **Push** that opens the summary page (`/summary?week=<id>`) in the dashboard or the parent app.
- **Summary page** in the dashboard and the parent app with the last 8 weeks.

The mail and the summary page are available in English, Danish, Swedish, Norwegian Bokmål and
German. Alert pushes and mails are still English and Danish only.

## Alert policy

| Class | Events |
|---|---|
| Act now (always sent at once) | SOS (calls to 112 never go through the server), a request or approval waiting for an answer, protection removed (lock lost, Plainphone no longer in control, set-up undone), the answer to a ring or "Are you okay?" the parent started, the test notification |
| Can wait | A phone that has been out of contact for a long time |

With **Only alert me when I must act** on (default), "can wait" news is not sent as a push or
mail. It is counted in the summary. SOS is never batched, and neither is anything classed
"act now". The setting has no effect when the summary is off or has no delivery channel (both
mail and push off), so news is never held back with no way to reach the parent.

The policy lives in `server/src/services/alert-policy.ts`.

## Settings

Per household (dashboard Settings, parent app Settings), all synced through the parent API:

| Setting | Default |
|---|---|
| Send a weekly summary | on |
| By email / by notification | on / on |
| Only alert me when I must act | on |
| Day and time | Sunday 18:00 |
| Time zone | Europe/Copenhagen |

Per phone (phone overview, "What to show for this phone"): **Weekly summary**, on by default.
Off means the server keeps no daily use for the phone and leaves it out of the summary. The
setting is in `GET /device/rules` as `weeklySummaryEnabled`, but the phone does not act on it, so changing it does not advance the rules revision or wake the phone:
the phone still reports `timeUsed` for the parent's live "used today" view.

## API

| Route | What |
|---|---|
| `GET /households/{hid}/summary-settings` | The settings above, and whether the server can send mail |
| `PATCH /households/{hid}/summary-settings` | Change any of `enabled`, `byMail`, `byPush`, `actNowOnly`, `day` (0 = Sunday), `hour`, `minute`, `timeZone` |
| `GET /households/{hid}/summaries` | The last 8 summaries, newest first |
| `PATCH /phones/{pid}` | `weeklySummaryEnabled` |

## Evidence

See [the evidence review](evidence.md#by-feature). In short: batching notifications can lower
stress in adults (Fitz et al. 2019), the evidence for parents is indirect, and design principles
7 and 8 (neutral figures, daily totals rather than timelines) shape what is in the summary.
