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

New in the alpha review (November 2026), written without a native speaker: the alpha
notice on the front page (`alpha` in `site/content/home.mjs`), the status label and the
iPhone answer in the FAQ, and the whole press kit page (`site/content/press.mjs`).

New for Google Play review (November 2026), written without a native speaker: the account
deletion page (`site/content/delete-account.mjs`) and the "Sign in with a code" texts
(`login.code*` in `packages/i18n`).

Website copy lives in `site/content/`. See the [site README](../site/README.md)
for build and check commands.


Every text the server writes itself is in all five languages, chosen from the parent's language (English only when it is unknown): pushes in `server/src/lib/push-text.ts`, mails in `server/src/lib/mail-templates.ts` and the weekly summary in `server/src/lib/summary-text.ts`. Each message is one table keyed by language, and `server/test/locale-completeness.test.ts` fails if a language is missing. The Swedish, Norwegian and German server texts need native review. Mails in all five languages, light and dark: `docs/screenshots/mail-locales/` (made by `scripts/screenshot-mail-locales.sh`).
The approval summary shown inside the apps (`approval-summary.ts`) is still English and Danish; it is neither a push nor a mail.

The Android app, web dashboard and parent app also include these five languages.
The fallback SMS that the phone builds itself when the server cannot be reached (the SOS text, `sos_sms_*` in the Android string resources) is in the phone's language too; `QuickMessageFallbackTest` checks all five and scans the source for hard-coded text. A code word's SMS is only the child's own text and a map link.
Swedish, Norwegian Bokmål and German need native review there as well. Prioritize
setup and release instructions, emergency and contact screens, and permissions.
Android strings live in `android/app/src/main/res/values-*/`. Web catalogs live in
`packages/i18n/src/` (`@plainphone/i18n`), which the web app and the parent app both import.
The iPhone lines (`packages/i18n/src/platform.ts`) use Apple's own names for its settings: Nedetid,
Nedtid, Nedetid and Auszeit for Downtime; Skærmtid, Skärmtid, Skjermtid and Bildschirmzeit for
Screen Time; Kommunikationsgrænser, Kommunikationsgränser, Kommunikasjonsgrenser and
Kommunikationslimits for Communication Limits; Familiedeling, Familjedelning, Familiedeling and
Familienfreigabe for Family Sharing. Check them against Apple's Settings app in each language.
The child's iPhone (`iphone.*` in `parent-app/src/i18n/app-*.ts`) uses the same names, plus Kun
kontakter, Endast kontakter, Bare kontakter and Nur Kontakte for Contacts Only; those four are not
checked against Apple's Settings yet. The shield's words live in Swift
(`parent-app/modules/plainphone-screentime/ios/Core/ShieldCopy.swift`), because the shield
extension has no React Native; its unit test checks all five languages. Setup screens speak to
the parent (German: Sie), the child's screen and the shield to the child (German: du).
