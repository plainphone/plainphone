# Silent bedtime, and approving with the parent PIN

Two small features that belong together: the phone is quiet at night, and a parent who is standing next
to the child can answer a request on the phone itself. Both have a switch per phone, both default to
on, and both follow the [design principles](design-principles.md): the child is told what the phone
does and why, and parents, 112 and help lines can always get through.

| Switch | Default | Where | What it does |
|---|---|---|---|
| **Silent bedtime** (`silentBedtime`) | on | Dashboard and parent app: Schedules | During a bedtime window the phone makes no sound and shows no notifications. Calls from parents, 112 and help lines still ring |
| **Approve on the phone with the PIN** (`pinApprovalEnabled`) | on | Dashboard and parent app: the phone's page (child phones only) | A request can be approved on the phone itself with the parent PIN |

Both reach the phone in `GET /device/rules`. A missing `silentBedtime` means on, so an older server
never turns it off by accident. A missing `pinApprovalEnabled` means off, because an older server has no
endpoint to report the approval to.

## Silent bedtime

### Why

Phones in the bedroom go with shorter and poorer sleep. Bedtime media use is associated with inadequate
sleep (Carter et al. 2016, JAMA Pediatrics: odds ratio 2.17), the Danish Health Authority advises keeping
phones out of the bedroom, and the EU guidelines on minors under the Digital Services Act name quiet hours
by default among their measures (¶57(b)(vii)). The evidence is observational, so the dashboard
says "goes with", not "causes" ([evidence.md](evidence.md)).

### What is silent

While a bedtime window is on and the switch is on:

| What | What happens |
|---|---|
| A call from a **parent** | Rings |
| A call back after the phone called **112** (one hour) | Rings, from any number |
| A call from a **help line** that the child called or texted a moment ago | Rings |
| A call from anyone else the phone allows (a friend on the approved list) | Does not ring and does not light the screen. It stays in the call log as a missed call and in the notification shade without a sound |
| Messages | Arrive without sound, vibration or a heads-up, whoever sent them |
| Notifications from other apps | Silent when Android has given Plainphone access to Do Not Disturb (below). Apps outside the bedtime window's list are hidden and cannot notify anyway |
| Alarms, "Ring the phone" from a parent, an SOS | Always make sound. Calling 112 always works |

**Who is a parent?** The contacts the parent marked as parents in the dashboard (the ones that get an
SOS). If no one is marked, every approved contact may ring, because the phone cannot tell who the parents
are and a parent must never be silenced by accident. Mark the parents under Contacts to make the silence
complete.

### How, in strong and in light mode

- **Strong mode (Device Owner)** and **light mode** use the same pieces, because Plainphone is the phone
  and messages app in both: call screening decides whether a call rings, and Plainphone's own
  notifications use a silent channel at bedtime. In strong mode, apps outside the window's list are also
  hidden by the lock, so they cannot make a sound.
- **Do Not Disturb.** Both modes also switch Android's Do Not Disturb on for the window (only alarms and
  calls may break through) and put the phone's own setting back when bedtime ends. Android lets only a
  person give an app access to Do Not Disturb, also on a Device Owner phone, so Plainphone cannot grant
  it to itself. Until it is granted, calls and Plainphone's own messages are silent, and other apps can
  still make sounds. The maintenance screen (behind the parent PIN) says so in plain words and has one
  button that opens Android's Do Not Disturb access screen. If the child or a parent changes Do Not Disturb
  during bedtime, Plainphone does not fight it and does not touch it afterwards.
- A maintenance unlock and releasing the phone end the silence at once.

### What the child sees

The home screen says it, under "Bedtime until 07:00": *The phone is silent. Only parents and help lines
ring.* and *Everyone sleeps better when the phone is quiet at night.* Neutral words, no judgement, no
streaks ([principle 7](design-principles.md)).

### The recommendation

The dashboard and the parent app show a short recommendation once, on the Schedules page: *Let the phone
sleep outside the bedroom*, with a link to the [Danish Health Authority's
recommendations](https://www.sst.dk/udgivelser/2023/Sundhedsstyrelsens-anbefalinger-om-skaermbrug). It has one button, "Got it", and is
remembered on that browser or device. It is advice, not a rule: Plainphone cannot know where the phone
sleeps.

## Approving a request on the phone with the parent PIN

### Why

A request that waits for a parent who is in the next room, or in the same one, invites a workaround.
When the parent is right there, the quickest honest answer is on the phone itself. Requests with reasons
and visible answers keep the conversation going ([evidence.md](evidence.md): child requests). The PIN
is the same one that opens the maintenance screen, so no new secret exists.

### How it works

1. The child opens **My requests** from the home screen (a quiet line, "1 request is waiting for an
   answer", shown only while something waits and the switch is on).
2. A waiting request has one button: **A parent is here: approve with PIN**. The PIN box asks for the
   parent PIN. Nothing else is on the screen, the screen is excluded from screenshots, and the PIN is
   never logged or stored.
3. The PIN is checked on the phone with the same check and the same rate limit as the maintenance screen
   ([`ParentPinCheck`](../android/app/src/main/java/org/plainphone/app/requests/ParentPinCheck.kt)):
   five free tries, then 1, 2, 4 ... minutes up to an hour. The phone's test PIN from setup never
   approves anything.
4. A right PIN is saved on the phone, then reported with
   `POST /device/requests/{id}/approve-on-phone`. The phone is the authority for what it did, so the
   report is a report, not a question: offline, it is kept and sent with the next sync, and the server
   never refuses it ([sync-api.md](sync-api.md)).
5. The server applies it like a parent's approval (the app is shown, the contact is added), marks the
   request `decidedVia: "phone"` and tells the parents: *Approved on Alma. A parent approved it on the
   phone with the PIN.*

### One answer model everywhere

First answer wins. The report is idempotent: a repeat changes nothing, and if a parent answered first in the
dashboard or the parent app, the report returns what was decided (`won: false`) and the phone shows that
answer. In the other direction, a parent who answers after the PIN approval gets `409` with
`outcome: "approvedOnPhone"`, and the dashboard says *This was already approved on the phone with the PIN*
(the same copy as the other outcomes: `status.outcome.*`). The dashboard's request page also lists the
last few answers for three days, with "Approved on the phone" when that is where it came from.

Only child phones: a Self phone has no parent PIN, and its approvals go through the key.

### Switching it off

With **Approve on the phone with the PIN** off, the home line and the button disappear and the phone
shows no way to approve. The switch syncs through `/rules`; an approval that was entered a moment before
the parent turned it off is still recorded, because the phone has already done it.

## API

| Field / call | Description |
|---|---|
| `GET /device/rules` → `silentBedtime`, `pinApprovalEnabled` | The two switches. `pinApprovalEnabled` is always false on a Self phone |
| `PATCH /api/phones/{pid}` with `{ "silentBedtime": false }` or `{ "pinApprovalEnabled": false }` | Parents change a switch. Advances the rules revision and wakes the phone |
| `POST /device/requests/{id}/approve-on-phone` | The phone reports an approval with the PIN. `200` with the request and `won`; `404` unknown request; `409` Self phone |
| `GET /api/phones/{pid}/requests` | Now also returns `recent`: the answers from the last 3 days with `decidedVia` |
| `POST /api/phones/{pid}/requests/{rid}/approve` and `/reject` | A late answer gets `409` with `outcome`: `approvedByYou`, `approvedByOther`, `approvedOnPhone`, `declinedByYou` or `declinedByOther` |

Migration `0042_bedtime_pin_approval` adds `phones.silent_bedtime`, `phones.pin_approval_enabled` (both
default true) and `phone_requests.decided_via`.

## Not covered

- Other apps' sounds without Do Not Disturb access (see above).
- The phone cannot know that it is in the bedroom. The recommendation is advice.
- Creating app and contact requests from the phone is not part of this change. The API exists
  ([sync-api.md](sync-api.md)); the requests screen lists what exists and offers the PIN approval.
  Asking for more time (#36) will plug into the same PIN box.
