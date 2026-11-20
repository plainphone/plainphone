# Location, "Ring the phone" and "Are you okay?"

The ordinary location feature keeps one position per phone and no history (decision D7).
Each [SOS event](sos.md#privacy) can separately keep one position for up to 30 days.

## Location modes

| Mode | The phone sends its position | Default for |
|---|---|---|
| `off` | never; switching off deletes the stored position and blocks any in-flight upload that has yet to be saved | an adult's own phone (Self) |
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

### Location time and accuracy

Each location lookup has one 30-second budget. Find and check-in lookups give the fused
provider the first 15 seconds when it is enabled. If no fix accurate to 100 m or better
arrives in that time, GPS and the network provider join in parallel while fused keeps
listening. If fused is unavailable, GPS and the network provider start immediately.
The first fix accurate to 100 m or better wins. At the deadline, the phone uses the most
accurate fix received. Cleanup removes provider listeners and asks their callback threads to stop.
The lookup waits up to 100 ms in total for those threads to exit and skips or ends that wait if interrupted.
Regular `always` reports use fused when enabled and Android 12's low-power setting. On older
Android versions without fused, regular reports give the network provider up to 500 ms to
deliver a fix accurate to 100 m or better before starting GPS. Both providers share the same
deadline.

Before starting a lookup, Find can reuse the newest eligible cached position from any provider
recorded at or after the request if it is younger than 2 minutes and accurate to 100 m
or better. Regular `always` reports can reuse a cached
position younger than 10 minutes and accurate to 1,000 m or better. If either lookup
gives no fix, the phone can send its newest known position with the original recorded time.
A position older than the request leaves Find open. Check-in lookups only accept a fix
taken during the lookup and after the check-in was created.

Find attempts are due at 0, 2, 5, 10 and 15 minutes after the request. An unanswered
"Are you okay?" uses the same schedule, starting at the reply deadline on the phone's
clock, and only if the child has yet to answer. Both stop scheduling lookups after
success or after 30 minutes. A delayed sync runs only the latest due attempt.
The phone sends saved uploads first, starting with check-in, then a saved or
eligible cached Find position. A post-request cached fix must be accurate to 100 m or better
to skip the precise lookup. A coarser fix is available as a fallback after the lookup.
The phone runs any remaining lookups in order of server expiry,
and uploads each result before starting the next lookup. The server allows
30 minutes from the check-in reply deadline or the time Find was requested.
A cached Find position can also go out between GPS attempts, including after the
last scheduled attempt. An upload recorded before the Find request leaves any
due GPS attempt available. Check-in eligibility uses the clock at the start
of location reporting, so an earlier lookup cannot consume its local window.

The phone keeps a saved check-in position through temporary upload failures and
retries while server rules still show the request is due, even if the phone
clock says the window has expired. After a 409 response, the next rules decide
whether to keep it. A local answer suppresses the upload. If the server rejects
a position as invalid, the phone remembers its recorded time, skips it on future
attempts and counts the rejection toward the retry schedule.

The server holds a check-in fix privately for at least one second after both receipt
and the server deadline. The next sweeper pass publishes it if the check-in still
has no answer and has not been cancelled. Its `locatedAt` is the later of the time the
fix was received and the reply deadline, so an older app that uploads a few seconds early
never shows a position from before the deadline. Find and regular positions remain available
as soon as the server accepts them. A fix tagged `checkin:<id>` that was recorded before the
deadline is refused with `400` (a `409` would make the phone keep and resend it).

When Find and a due check-in are open together, the phone makes one precise lookup and
uploads its fix for both, as long as the fix is new enough for each (recorded after the Find
request, and after the check-in deadline and creation). A fix that is too old for one request
does not answer it, and that request gets its own lookup.

If the server says the position is due but the phone's clock has not reached the deadline
yet (up to 2 minutes behind), the phone shortens its next poll to the time left instead of
waiting for the normal 60 seconds, because a fix recorded earlier would be refused.

If an upload fails after the request may have been sent (for example a reset or a timeout
while waiting for the answer), the server may have stored the fix without the phone hearing.
Failures that show the request never got through (no DNS, refused or unreachable connection,
TLS errors) do not count. The phone marks that saved fix, and a `409` on its retry then counts as
sent: Find and check-in are marked answered and the "position sent" notice is shown. A
`409` for a fix that never had a lost answer is still a refusal. The same goes for the
automatic retry inside one upload on a fresh connection (known limit: that retry can follow a
stale reused socket that never carried the first attempt).

Precise lookups give fused a 15 second head start. If fused fails to start, is turned off or
answers without a good fix before then, GPS and network start straight away and keep the rest
of the 30 second budget.

Find can start when the phone clock is up to 2 minutes behind, and the phone keeps a pending
upload for up to 2 extra minutes in case its clock is ahead. Between Find attempts, a due
`always` report can reuse a cached position that meets the regular age and accuracy limits
without starting a new lookup. Regular reports wait while a check-in location is due.

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
- The phone sends the child’s answer to the parent and cancels any remaining check-in uploads.
- The parent can cancel while the question is waiting for an answer, even if its position
  arrived before the reply deadline.
- While a check-in is unanswered and the upload window is open, modes `checkin` and `always`
  follow the lookup schedule above until one position is sent or the window expires. Modes
  `find` and `off` send no check-in position.

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
