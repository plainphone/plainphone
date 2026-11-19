# App catalog

The catalog is a short list per country of apps a parent may want on a calm phone: MitID,
the bank, the travel planner, the school app, a music app. In the parent app a parent adds
one with one tap. The phone then treats it as allowed and offers to install it. In strong mode,
if Play needs an account, the parent can choose “Install and add a Play account” and enter their
maintenance PIN. Plainphone requests Google sign-in directly while Android continues to block
user account changes. If sign-in fails, **Allow accounts briefly** retries within the same
window. The restriction returns when Android reports a visible account change, sign-in ends,
or the catalog window closes. It also returns at most three minutes after tapping the button,
even if there is time left to install the app. Play opens after successful sign-in if the approved
install window is still active.

Apps marked `"starter": true` form the starter pack: they are allowed from the start when a
phone reports them.

## Public lookup

The [app and website lookup](https://plainphone.org/apps/) is available without an
account. The site builds the catalog entries from the same country files the server
uses. A separate list of known websites shows the default for child and self-managed
phones. It covers selected domains only, and neither a catalog match nor a website
result tells you whether every network service an app needs will work. Families can
change the filter categories and domain rules for each phone as before.

## Files

One JSON file per country in [`server/catalog/`](../server/catalog), named after the country
code (`dk.json`). The server reads and checks every file when it starts and refuses to start
when one is wrong. The files are public: `GET /api/catalog` lists the countries and
`GET /api/catalog/{country}` returns a file as it is.

```json
{
  "country": "dk",
  "name": { "en": "Denmark", "da": "Danmark" },
  "verifiedAt": "2026-11-17",
  "categories": [{ "id": "public", "name": { "en": "MitID and public services", "da": "MitID og det offentlige" } }],
  "apps": [
    {
      "packageName": "dk.mitid.app.android",
      "name": "MitID",
      "category": "public",
      "starter": true,
      "source": "https://play.google.com/store/apps/details?id=dk.mitid.app.android",
      "verifiedAt": "2026-11-17",
      "playTitle": "MitID"
    }
  ]
}
```

| Field | Rule |
|---|---|
| `packageName` | A real Android package name, unique in the file. Never guessed |
| `category` | One of the file's category ids |
| `source` | Exactly `https://play.google.com/store/apps/details?id=<packageName>` |
| `verifiedAt` | The date you checked the Play page (`YYYY-MM-DD`) |
| `playTitle` | The title the Play page showed that day |

A test (`server/test/light-mode.test.ts`) checks every file against these rules.

Some apps are left out on purpose because they have no Android app on Play: regional bus
operators such as FynBus, NT and BAT are covered by Rejsebillet and Rejsekort, and
MinUddannelse is web only.

## Which phones get which catalog

For now the phone's time zone decides: `Europe/Copenhagen` gets `dk`, other phones get no
catalog. When a second country is added, the phone will get a country setting instead.

## Adding a country

1. Copy `dk.json` to `<code>.json` (ISO 3166 two-letter code, lowercase) and set `country`,
   `name` and the categories you need.
2. For every app, open its Play page and check that it answers and shows the app you mean:

   ```sh
   pkg=dk.mitid.app.android
   curl -s -o page.html -w "%{http_code}\n" "https://play.google.com/store/apps/details?id=$pkg&hl=en"
   grep -o '<title[^>]*>[^<]*' page.html
   ```

   The status must be `200` and the title must be the app's. Write the title in `playTitle`
   and today's date in `verifiedAt`. A `404` means the package name is wrong: find the right
   one from the app's own website or the Play search, never by guessing.
3. Mark only the apps every family in that country needs as `"starter": true`.
4. Run the server tests (`pnpm --filter @plainphone/server test`), then open a pull request.
