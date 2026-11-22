# @plainphone/i18n

The copy the web dashboard ([`../../web`](../../web)) and the parent app
([`../../parent-app`](../../parent-app)) share, in English, Danish, Swedish, Norwegian Bokmål and
German: `en.ts` defines every key, the other catalogs must have the same keys (the type checks
it), and the topic files (`status.ts`, `billing.ts`, `platform.ts` and the rest) are spread into
them. `translate.ts` picks a locale and fills in parameters; `phone-language.ts` lists the
languages a phone can be set to.

Import a file by name: `import { makeT } from "@plainphone/i18n/translate"`. The package is
TypeScript source, compiled by each app's bundler. Copy only the native app needs stays in
`parent-app/src/i18n/app-*.ts`. Translation status: [docs/translations.md](../../docs/translations.md).
