# Family inbox

The family inbox is one short conversation between a Child phone and its parents, inside the
phone's own Messages app. The child sends the quick messages the parents approved and, when
check-ins are on, "I'm home". Parents answer with a short reply from the dashboard or the parent
app. It is built for repeat family logistics with a short interaction, not for chatting
([diary study](https://doi.org/10.1111/cdev.14203), [research](research/family-comms.md#family-inbox)).

There are no read receipts, no "typing", no "last seen", no streaks and no photos. The child sees
who gets the messages and where each one is; the parents see whether a reply has reached the phone.

## Switches

Every part has its own switch on a Child phone's page in the dashboard and the parent app
(**Family inbox**, below **Quick messages**). All are off for a new phone. They sync through
`/rules`, and the child sees on **What can my parents see?** that the inbox is on and that a
check-in sends no location (design principle 1).

| Switch | Default | What it does |
|---|---|---|
| **Family inbox** (`familyInbox`) | off | The **Family** conversation at the top of Messages on the phone, the thread on the phone's page for parents, and short replies |
| **Quick messages** (`quickMessagesEnabled`) | off for new phones | The quick messages from [SOS](sos.md#hidden-sos-and-quick-messages), sent with one tap. In the inbox they need the inbox to be on; on the SOS screen they do not |
| **Check-ins** (`checkIns`) | off | The **I'm home** button in the Family conversation. It sends no position. Needs the inbox |

Quick messages and check-ins are independent switches, but their buttons in the inbox only appear
while the inbox is on. When the inbox is off, the Messages app shows the quick messages above the
conversations, as before. Code words keep following the SOS settings (see below).

Phones paired before this change keep the quick-message setting they had (on); only new phones
start with it off.

## On the child's phone

Messages shows **Family** first, with the newest line. The conversation shows:

- the parents' replies, with the name each parent signs with;
- the child's own messages, each with where it is: **Sending…**, **Delivered** (a parent device got
  a push), **Sent as SMS** (no parent device could get it, so the phone sent an ordinary SMS),
  **Sent** (over the send limit: recorded, but nobody was notified), or **Not sent**;
- the quick messages and **I'm home** at the bottom;
- one line at the top saying who can read the conversation.

A new reply shows a notification. During silent bedtime it arrives quietly, like an SMS.

## Delivery

A message from the inbox goes through the same path as any quick message
(`POST /device/quick-messages/send` with `inbox: true`, the `kind` and the original `sentAt`):

1. Online, the server records it in the thread and pushes it to the parents. It is never an urgent
   push, also in the child's quiet hours.
2. If no parent device got the push, or the phone cannot reach the server, the phone sends it as an
   ordinary SMS to the SOS parents.
3. After an offline SMS the phone reports the message again once it has a network, with
   `smsSent: true`. The server adds it to the thread with its original time and notifies nobody,
   because the parents already have the SMS. The phone gives up on this after a day.

A repeated id (a retry after a lost answer) never adds a second row or a second push. The phone is
the authority for what it has already sent: the server records a message even if the inbox was
switched off while it was on its way.

Parent replies: `POST /phones/{pid}/inbox` stores the reply and wakes the phone. The rules' `inbox`
block carries the id of the newest reply (`latest`); when it changes, the phone fetches
`GET /device/inbox` and sends the device receipt (`POST /device/inbox/received`). The parents then
see **On the phone** with the time. A reply is refused (403) while the inbox is off.

## Code words

A quick message marked as a code word goes through the [SOS path](sos.md#hidden-sos-and-quick-messages),
also from the inbox: an urgent SOS with position (when location sharing allows it), its original
timestamp and SOS escalation. On the child's phone it looks exactly like any other message in the
conversation. It is never stored in the thread on the server; its history is the SOS history.

## Privacy

The server can read the family inbox, like the quick messages: it is not end-to-end encrypted.
The dashboard, the parent app and the child's phone say so. The thread keeps the newest 50 messages
per phone and nothing older than 30 days, and it is deleted with the phone. Free text from the child
is not possible: the child sends only approved quick messages and check-ins. A parent's reply is at
most 60 characters. End-to-end encryption and free text are a separate piece of work
([research](research/family-comms-issues.md)).

## API

| Endpoint | Who | What |
|---|---|---|
| `PUT /phones/{pid}/sos` with `familyInbox`, `checkIns`, `quickMessagesEnabled` | parent | The switches |
| `GET /phones/{pid}/inbox` | parent | The switches, the recipients and the newest 30 messages |
| `POST /phones/{pid}/inbox` `{ text, name? }` | parent | A short reply (403 while the inbox is off) |
| `POST /device/quick-messages/send` `{ id, text, inbox, kind, sentAt, smsSent? }` | phone | A message from the inbox |
| `GET /device/inbox` | phone | The thread |
| `POST /device/inbox/received` `{ ids }` | phone | The device receipt for replies |

Self-hosting: update the server before the phone app. An older server rejects the new fields of
`POST /device/quick-messages/send`, and the phone does not fall back to SMS after a rejection.
