// SPDX-License-Identifier: Apache-2.0
import type { Locale } from "../lib/api";
import { isLanguage, languages } from "../lib/phone-language";
import { sv } from "./sv";
import { nb } from "./nb";
import { de } from "./de";
import { da } from "./da";
import { en, type MessageKey, type Messages } from "./en";

export type { MessageKey };
export type Params = Record<string, string | number>;
export type T = (key: MessageKey, params?: Params) => string;

export const catalogs: Record<Locale, Messages> = { en, da, sv, nb, de };
export const LOCALES: Locale[] = languages;

export function translate(messages: Messages, key: MessageKey, params?: Params): string {
  const s = messages[key];
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

export function makeT(locale: Locale): T {
  return (key, params) => translate(catalogs[locale], key, params);
}

/** Picks a supported locale from a saved value or the browser's languages. */
export function pickLocale(saved: string | null | undefined, browser: readonly string[]): Locale {
  if (isLanguage(saved)) return saved;
  for (const tag of browser) {
    const base = tag.toLowerCase().split("-")[0];
    if (base === "no") return "nb";
    if (isLanguage(base)) return base;
  }
  return "en";
}
