# Location, "Ring the phone" and "Are you okay?"

Plainphone keeps one position per phone and no history (decision D7). This page describes when a
phone sends its position, how a parent finds a phone, and what the child sees.

## Location modes

| Mode | The phone sends its position | Default for |
|---|---|---|
| `off` | never; the stored position is deleted | an adult's own phone (Self) |
| `find` | once each time a parent presses Find | |
| `checkin` | on Find, and once when an "Are you okay?" goes unanswered | a child's phone |
| `always` | every 5 minutes, plus the above, for 1 hour, today or 7 days | nobody: a parent has to choose it and how long |

`PUT /api/phones/{pid}/location/mode` changes it. The server refuses positions the mode does not
allow (`409`), so the rule holds even against an old or modified app. On a Self phone, turning
location on applies at once (it is a tightening).

`always` is never open-ended. The parent picks how long (`alwaysFor`: `hour`, `today` = until
the phone's local midnight, or `week`); the server stores the end in `phones.location_always_until`,
stops taking 5-minute positions at that moment, and the sweeper moves the phone back to `checkin`
within a minute. The dashboard advises against it from age 13 with one line ("teenagers need
privacy, and constant tracking can harm trust"); Plainphone stores no age, so the line is always
shown under the option.

Phones paired before the modes existed were moved to `checkin` when they had location on
(migration `0006_safety`): sharing every 5 minutes is now an explicit choice.

## What the child sees

Plainphone does not share a position silently:

- **Each single position** (Find, or an unanswered "Are you okay?") shows a short, quiet
  notification: "Your parent pressed Find, and your location was sent at 16:40."
- **Always on** shows an ongoing notification ("Every 5 minutes, until 18:00") and a line on
  Plainphone's own screens (`LocationSharingLine`: the Today screen in light mode, the main screen
  in strong mode).
- **"What can my parents see?"** (`SharingActivity`, from that line and from every location
  notification) says in plain words what the current mode means, and lists every time the phone
  sent its position in the last 30 days: Find, unanswered "Are you okay?", or an "always" stretch
  shown as one line with a range. The list is kept only on the phone (`SafetyStore`), never sent.
- **"Are you okay?"** says on the screen that the position is sent once if nobody answers before
  the deadline (when the mode sends one).

A silent Find was considered and left out: a child who cannot tell when they are located is the
kind of tracking the privacy policy promises not to do, and the parent still gets the position.

## Find and the map

The PWA's location page shows the last position on a map (MapLibre GL, OpenFreeMap tiles, no API
key) with the time and an accuracy circle, plus "Drive there" links (Google Maps and Apple Maps,
Apple first on iPhone and iPad) and "Copy position". The map's code and tiles load only on that
page. The parent app shows the same, on OpenStreetMap raster tiles after "Show map" (see
[parent-app.md](parent-app.md)).

## Ring the phone

`POST /api/phones/{pid}/ring` with `stopOnAnswer` (default `true`).

- The phone plays the alarm sound on the alarm stream at full volume and vibrates. The alarm
  stream plays on silent and through do not disturb when alarms are allowed there (Android's
  default); "total silence" blocks it, and Plainphone cannot change that without notification
  policy access. The old alarm volume is put back afterwards, also after a crash.
- A full screen says "Your parent is looking for you" with one big "I'm here". It shows over the
  lock screen.
- "I'm here" stops the sound and tells the parent. With `stopOnAnswer: false` ("keep ringing for
  the full 5 minutes") the answer is sent but the sound goes on until the end.
- The parent can stop it from the dashboard (`DELETE .../ring`). It stops by itself after at most
  5 minutes, counted on the phone too.

## Are you okay?

`POST /api/phones/{pid}/checkin` with `minutes` (1 to 120; the dashboard offers 5, 10, 15, 30) and
optionally `callNumber`, one of the phone's approved contacts.

- The phone shows a calm full screen: "Are you okay?", "Yes, I'm okay" and, with a number,
  "Call me" (which answers and calls that contact).
- An answer is sent to the parent, and no position is sent.
- No answer by the deadline: in modes `checkin` and `always` the phone takes one precise position
  and sends it; in `find` and `off` nothing is sent. Either way the parent is told.

## Parent notifications

With Web Push on, the parents get: "I'm here", "Yes, I'm okay", "Call me", no answer by the
deadline (and whether a position is coming), and the position when it arrives. Without push the
location page shows the same status, refreshed every 5 seconds while something is open.

## Delivery without push

There is no FCM yet, so the phone polls:

| Phone state | A ring or question arrives within |
|---|---|
| Screen on | about 60 seconds (the normal fast poll) |
| Screen off, Android not in deep sleep | about 2 minutes (idle alarm every 2 minutes) |
| Screen off and still for a long time (Doze) | about 9 to 15 minutes, sometimes more |

While a ring or a question is open the phone polls every 10 seconds, so stopping and answering
are quick. FCM would make all three near-instant; polling stays the fallback.

## Data kept

One row per phone and kind (`safety_requests`): times, the answer and the "Call me" number. A
new request replaces the old one, and the sweeper deletes it a day after it ended.

## Evidence

The choices above follow the EU Commission's guidelines on the protection of minors under the
Digital Services Act (2025), point 81(d), on geolocation and parental tools; and the UK ICO Age Appropriate Design Code (Children's Code), standards 10 (geolocation: off by default,
an obvious sign while it is visible to others, back off after each session) and 11 (parental
controls: tell the child, with an obvious sign while they are being monitored). Hence: no silent
Find, a notice and a local log for every position, and "always" only for a chosen time.
