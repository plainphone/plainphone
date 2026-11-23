# App store review

What an app store reviewer needs to get into the parent app, and how the hosted service gives it
to them. The background (Google Play's rules and why a reviewer cannot use a login link) is in the
Play preparation notes ([play/policy-review.md](play/policy-review.md#reviewer-access)).

## The review sign-in

Plainphone signs in by a one-time link sent by mail. A reviewer cannot open that, and Google Play
asks for sign-in details that are reusable and always valid. So a server can name **one** address
that signs in with a fixed code instead:

| Setting | What |
|---|---|
| `REVIEW_LOGIN_EMAIL` | The review address. Only this address can use the code |
| `REVIEW_LOGIN_CODE` | The code: 32 to 200 characters, made with e.g. `openssl rand -base64 33`. Keep it secret and out of git |

Both unset (the default, and what every self-hoster should keep) means the path does not exist:
`POST /api/auth/review` answers 404 and no address is offered a code. Only one of them set, a
code shorter than 32 characters or an invalid address keeps it off, and `/api/health` reports
`review: …` under `errors`, without the values.

How it works when it is on:

- The reviewer types the review address in the app or the dashboard and taps the usual button.
  `POST /api/auth/request` sends that address no mail and answers `codeSignIn: true`, so the app
  shows a code field. Every other address gets the normal answer and a login link; nobody else
  ever sees the code field.
- `POST /api/auth/review` with `{ email, code }` signs in only when both match. The address and
  the code are compared as hashes in constant time, and both comparisons always run. A wrong
  address and a wrong code get the same `401`.
- Attempts are rate limited: 10 per client address per 15 minutes and 100 per hour in total. Each
  attempt is logged as `review sign-in: refused`, `signed in` or `rate limited`, never with the
  address or the code.
- The account is an ordinary account with its own household. It can do everything a parent can,
  including deleting itself.

## The demo phone

The parent app does nothing until a phone is paired, and a reviewer has no child's phone. On every
review sign-in, the review household gets a simulated phone, **Alex**, that talks to the server
through the same API a real phone uses (in process, `server/src/services/review-demo.ts`):

- paired in light mode as a Child phone running the Play edition ([play/play-edition.md](play/play-edition.md)):
  every protection on except device admin, which the Play edition never asks for, no **Update now**, and a
  battery level,
- an app list (phone, messages, camera, Duolingo, Spotify, YouTube, Minecraft and a few more),
  time used today, two contacts and a waiting request to allow Minecraft,
- a position in a public park in Copenhagen, sent as the answer to a Find the phone.

Every later review sign-in checks the same phone in again (last seen, time used, a new request if
the reviewer answered the last one, a fresh position unless a Find is still open; the app list and,
if the phone has none, the contacts are sent again). If the reviewer removes it, the next sign-in
makes a new one. A household that has a real phone paired is left alone. Everything is invented:
the contacts' numbers are in the 555-01xx range kept for fiction. The demo phone never answers a
new Find, a ring or a check-in, because there is no phone behind it.

## Google Play Console, App access

Choose "All or some functionality is restricted" and add one set of instructions:

- **Username:** the value of `REVIEW_LOGIN_EMAIL`
- **Password:** the value of `REVIEW_LOGIN_CODE`
- **Any other information:** "Type the address and tap Send login link. The app then asks for a
  code instead of sending a mail: enter the password above. The account has a demo child's phone
  (Alex) already paired, so every screen has data. The app that runs on the child's phone is
  distributed outside Google Play (plainphone.org)."

## Deleting an account

App stores ask for deletion inside the app and on a web page:

- in the app and the dashboard: Settings → Delete my account (`DELETE /api/me`,
  [account-deletion.md](account-deletion.md#deleting-an-account)),
- on the web: <https://plainphone.org/delete-account/> (and `/da/`, `/sv/`, `/nb/`, `/de/`
  versions), which explains both ways, by mail to privacy@plainphone.org without the app, what is
  deleted and how fast. It is linked from the privacy policy and the site footer. Use the English
  address in Play Console's Data safety form.
