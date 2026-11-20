# Family agreement

A few lines that a parent and a child agree on together, in the child's own words. The child sees them
on their phone. The adults can add rules for themselves too. It is shown on the child's phone only;
it is not enforced by anything ([design principle 4](design-principles.md)).

Optional and off until the family writes it. Two per-phone switches, both in the dashboard and the
parent app:

| Switch | Default | What it does |
|---|---|---|
| Show on the phone | on (but nothing is shown until there are words) | The agreement appears on "What can my parents see?" on the child's phone |
| Also show on the home screen | off | A short card on the phone's front page |

Turning the first switch off keeps the words, so they are there when it is turned on again.

## What is stored

| Field | Limit |
|---|---|
| What we agree (`lines`) | up to 8 lines of up to 140 characters, in the child's words |
| For the adults too (`adultLines`) | up to 5 lines of up to 140 characters; a suggestion, nothing is enforced |

Lines are trimmed, joined onto one row and stripped of control characters; empty lines are dropped.
The text is the family's own data: it lives on the phone's row, is shown only to that household and
that phone, and is never written to logs, the weekly summary or analytics. Another household's phone
answers 404 on every route. The agreement is for Child phones; a Myself phone answers 404.

## Setup and editing

An optional, skippable step in setup (dashboard and parent app) for Child phones: the two text boxes
with a counter, the reason ("writing it together helps everyone keep to it") and a plain "this is
optional". It can be written or changed later on the phone's page, under **Family agreement**.

## API

| Route | What |
|---|---|
| `GET /api/phones/{pid}/agreement` | `{ lines, adultLines, enabled, onHome, updatedAt }` |
| `PUT /api/phones/{pid}/agreement` | Any of `lines`, `adultLines`, `enabled`, `onHome`; more than 8 or 5 lines, or a line over 140 characters, is `400` |

The phone summary carries `agreementEnabled`, `agreementOnHome` and `agreementHasText`, but never the text.

## Rules document

`GET /device/rules` gets one additive field, `ageAgreement`, for Child phones, while the agreement is
on and has words. Old phones ignore it; a new phone treats a missing field as "no agreement".

```json
{ "ageAgreement": { "lines": ["I put the phone away at dinner"], "adultLines": ["Adults leave the phone in the hall too"], "onHome": false, "updatedAt": "2026-11-16T12:00:00.000Z" } }
```

A change advances the rules revision and wakes the phone, so the text follows within a minute.

## On the phone

"What can my parents see?" shows an **Our family agreement** section with the lines, and **For the adults
too** with the adult lines and the sentence that these are suggestions. With the second switch on, the
home screen shows the agreement as a calm card. Neither hides or moves Phone, SOS or 112, and the text
scales with large text and works with a screen reader, in light and dark.

## Evidence

See [the evidence review](evidence.md#by-feature), "Family agreement". Rules that families set together
are easier to keep (Hiniker et al. 2016; the Danish Health Authority's guidance on agreements in the
family; the AAP Family Media Plan), and parents know most when children tell them themselves (Stattin &
Kerr 2000). None of this is evidence that a written agreement changes outcomes, which is why it is
optional and editable, and why the adults' lines are suggestions.
