# Translations

The Plainphone website is available in English, Danish, Swedish, Norwegian
Bokmål and German. English and Danish are the source languages. The website
copy for Swedish, Norwegian Bokmål and German includes machine translations
with an editorial pass.

## Needs native review

| Language | Website |
|---|---|
| Swedish (`sv`) | Needed |
| Norwegian Bokmål (`nb`) | Needed |
| German (`de`) | Needed |

Review the privacy policy, setup, permissions and help pages first. Check the pricing
promise against the English and Danish pages. Read the longer strings in the
browser with large text.

The landing-page navigation, first-day steps, screenshots, FAQ entries, app
and website lookup and the help pages need native review in Swedish, Norwegian
Bokmål and German. Review the localized catalog labels in
`server/catalog/dk.json` as well.

Website copy lives in `site/content/`. See the [site README](../site/README.md)
for build and check commands.


The Android app, web dashboard and parent app also include these five languages.
Swedish, Norwegian Bokmål and German need native review there as well. Prioritize
setup and release instructions, emergency and contact screens, and permissions.
Android strings live in `android/app/src/main/res/values-*/`. Web catalogs live in
`web/src/i18n/`. Run `pnpm sync:shared` in `parent-app/` after updating the web catalogs.
