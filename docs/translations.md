# Translations

Plainphone for Android, the web dashboard, the parent app and plainphone.org
are available in English, Danish, Swedish, Norwegian Bokmål and German. The
Swedish, Norwegian Bokmål and German catalogs start from machine translations
with an editorial pass. English and Danish remain the source languages.

## Needs native review

| Language | Android | Web dashboard and parent app | Website |
|---|---|---|---|
| Swedish (`sv`) | Needed | Needed | Needed |
| Norwegian Bokmål (`nb`) | Needed | Needed | Needed |
| German (`de`) | Needed | Needed | Needed |

Review child-facing stop screens, emergency and contact copy, setup and release
instructions, permissions and the privacy policy first. Check plural forms and
placeholders in context, then check the longer strings with large text.

Android strings are in `android/app/src/main/res/values-*/`. Web strings are in
`web/src/i18n/`. After editing web strings, run `pnpm sync:shared` in
`parent-app/` to update the shared catalogs. Native-only strings live in
`parent-app/src/i18n/` and `parent-app/locales/`. Website copy lives in
`site/content/`. Server-generated emails, notifications and approval
summaries currently use Danish for Danish accounts and English for the other
languages.
