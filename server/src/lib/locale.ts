// SPDX-License-Identifier: Apache-2.0
//
// The five languages of the app (#137). Every text the server writes itself, a push or a
// mail, has one table with all five (test/locale-completeness.test.ts checks that).

export const LOCALES = ["en", "da", "sv", "nb", "de"] as const;
export type Locale = (typeof LOCALES)[number];

/** The language of a parent or household member. Unknown values fall back to English. */
export function toLocale(value: string | undefined | null): Locale {
  const v = value?.toLowerCase() ?? "";
  if (v.startsWith("da")) return "da";
  if (v.startsWith("sv")) return "sv";
  if (v.startsWith("nb") || v.startsWith("no") || v.startsWith("nn")) return "nb";
  if (v.startsWith("de")) return "de";
  return "en";
}

/** The `Intl` locale used for dates and times in a language. */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-GB", da: "da-DK", sv: "sv-SE", nb: "nb-NO", de: "de-DE" };
