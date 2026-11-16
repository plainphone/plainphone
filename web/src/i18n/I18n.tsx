// SPDX-License-Identifier: Apache-2.0
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Locale } from "../lib/api";
import { makeT, pickLocale, type T } from "./translate";

const STORAGE_KEY = "pp.locale"; // a language preference, not a credential

interface I18nValue {
  locale: Locale;
  t: T;
  setLocale: (l: Locale) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

function initialLocale(): Locale {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    saved = null;
  }
  return pickLocale(saved, navigator.languages?.length ? navigator.languages : [navigator.language]);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // private mode: the choice lasts for this visit
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const value = useMemo(() => ({ locale, t: makeT(locale), setLocale }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n outside I18nProvider");
  return v;
}
