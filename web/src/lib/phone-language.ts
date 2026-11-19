// SPDX-License-Identifier: Apache-2.0
export const languageNames = {
  da: "Dansk",
  en: "English",
  sv: "Svenska",
  nb: "Norsk bokmål",
  de: "Deutsch",
} as const;

export type Language = keyof typeof languageNames;
export type PhoneLanguage = Language | null;

export const languages = Object.keys(languageNames) as Language[];

/** Server-generated messages have English and Danish versions. */
export function messageLanguage(locale: Language): "en" | "da" {
  return locale === "da" ? "da" : "en";
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && Object.hasOwn(languageNames, value);
}
