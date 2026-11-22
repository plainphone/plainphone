// SPDX-License-Identifier: Apache-2.0
//
// The phone's language decides until the user picks one; the
// choice is kept on the device and in the account (PATCH /me).
import { getLocales } from "expo-localization";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Locale } from "../api/models";
import { catalogs, pickLocale, translate, type MessageKey, type Params } from "@plainphone/i18n/translate";
import { isLanguage } from "@plainphone/i18n/phone-language";
import { appSv } from "./app-sv";
import { appNb } from "./app-nb";
import { appDe } from "./app-de";
import { appDa } from "./app-da";
import { appEn, type AppMessageKey, type AppMessages } from "./app-en";
import { getItem, setItem } from "../lib/storage";

export type Key = MessageKey | AppMessageKey;
export type TFn = (key: Key, params?: Params) => string;

const STORAGE_KEY = "pp.locale";
const appCatalogs: Record<Locale, AppMessages> = { en: appEn, da: appDa, sv: appSv, nb: appNb, de: appDe };

export function makeAppT(locale: Locale): TFn {
  return (key, params) => {
    if (key in appEn) {
      const s = appCatalogs[locale][key as AppMessageKey];
      return params ? s.replace(/\{(\w+)\}/g, (m, n: string) => (n in params ? String(params[n]) : m)) : s;
    }
    return translate(catalogs[locale], key as MessageKey, params);
  };
}

export function deviceLocale(): Locale {
  let tags: string[] = [];
  try {
    tags = getLocales().map((l) => l.languageTag);
  } catch {
    tags = [];
  }
  return pickLocale(null, tags);
}

interface I18nValue {
  locale: Locale;
  t: TFn;
  setLocale: (l: Locale) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initial ?? deviceLocale);
  useEffect(() => {
    if (initial) return;
    void getItem(STORAGE_KEY).then((saved) => {
      if (isLanguage(saved)) setLocaleState(saved);
    });
  }, [initial]);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    void setItem(STORAGE_KEY, l).catch(() => undefined);
  }, []);
  const value = useMemo(() => ({ locale, t: makeAppT(locale), setLocale }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n outside I18nProvider");
  return v;
}
