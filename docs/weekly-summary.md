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
- **No near-empty first summary.** A household gets its first summary at the first due time after
  a full week of history. History starts when the feature went live for the household
  (`households.summary_since`, set to the migration time for households that existed then) or when
  the phone enrolled, whichever is later; the oldest phone that is in the summary counts. Until
  then the summary page says "Your first summary comes on <date>" (`firstSummaryOn` in
  `GET /households/{hid}/summaries`).
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
| Act now (always sent at once) | SOS (calls to 112 never go through the server), a request or approval waiting for an answer, protection removed (lock lost, Plainphone no longer in control, set-up undone), a phone that has been out of contact (a reset or switched-off child phone also looks offline), the answer to a ring or "Are you okay?" the parent started, the test notification |
| Can wait | Nothing yet |

Offline alerts stay immediate (Mads 19/11-26: "Offline altid med det samme"). The policy and the
**Only alert me when I must act** switch stay in place for future purely informational news
(`CAN_WAIT` in `alert-policy.ts`); until such news exists the switch changes nothing, and its
explanation in the dashboard and the parent app says so. When something is added, it goes into the
summary instead of a push or mail. The setting has no effect when the summary is off or has no
delivery channel (both mail and push off), so news is never held back with no way to reach the
parent. Out-of-contact news is still counted in the summary.

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
Off means the server keeps no daily use and no rule-change news for the phone and leaves it out of
the summary. The setting is in `GET /device/rules` as `weeklySummaryEnabled`. The phone does not
change what it reports (it still sends `timeUsed` for the parent's live "used today" view), but it
uses the setting to tell the child.

## What the child is told

Design principle 1: the phone says what parents can see. When `weeklySummaryEnabled` is on, "What
can my parents see?" on the child's phone adds that once a week the parents get a summary of screen
time per day, the most used apps, requests, rule changes and times the phone was out of contact, and
never messages, calls or what the child does inside apps. The notice is shown on child phones only
and in all five languages. Screenshots: `docs/screenshots/weekly-summary/sharing-*.png`.

## API

| Route | What |
|---|---|
| `GET /households/{hid}/summary-settings` | The settings above, and whether the server can send mail |
| `PATCH /households/{hid}/summary-settings` | Change any of `enabled`, `byMail`, `byPush`, `actNowOnly`, `day` (0 = Sunday), `hour`, `minute`, `timeZone` |
| `GET /households/{hid}/summaries` | The last 8 summaries, newest first, and `firstSummaryOn` (the local date of the first summary while there is none yet) |
| `PATCH /phones/{pid}` | `weeklySummaryEnabled` |

## Evidence

See [the evidence review](evidence.md#by-feature). In short: batching notifications can lower
stress in adults (Fitz et al. 2019), the evidence for parents is indirect, and design principles
7 and 8 (neutral figures, daily totals rather than timelines) shape what is in the summary.
