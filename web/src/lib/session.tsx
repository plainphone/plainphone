// SPDX-License-Identifier: Apache-2.0
import { isLanguage } from "./phone-language";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n/I18n";
import { api, ApiError, type Locale, type Me, setUnauthorizedHandler } from "./api";
import { disablePush, PUSH_ID_KEY } from "./push";

/** Where to go after the login round trip. Kept per tab, never a credential. */
export const NEXT_KEY = "pp.next";
export const INVITE_KEY = "pp.invite";

export function rememberNext(path: string) {
  try {
    sessionStorage.setItem(NEXT_KEY, path);
  } catch {
    // ignore
  }
}
export function takeNext(): string {
  try {
    const invite = sessionStorage.getItem(INVITE_KEY);
    if (invite) return "/invite";
    // Read only: render code calls this. The Shell clears it once the user is there.
    const next = sessionStorage.getItem(NEXT_KEY);
    // Only same-app paths.
    if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  } catch {
    // ignore
  }
  return "/";
}

/** Forgets the stored destination once the user has reached it. */
export function clearNextIf(path: string) {
  try {
    if (sessionStorage.getItem(NEXT_KEY) === path) sessionStorage.removeItem(NEXT_KEY);
  } catch {
    // ignore
  }
}

type State = { status: "loading" } | { status: "anon"; error?: unknown } | { status: "in"; me: Me };

interface SessionValue {
  state: State;
  refresh: () => Promise<Me | null>;
  logout: () => Promise<void>;
  saveLocale: (l: Locale) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { setLocale, locale } = useI18n();
  const [state, setState] = useState<State>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<Me>("/me");
      setState({ status: "in", me });
      if (isLanguage(me.user.locale)) setLocale(me.user.locale);
      return me;
    } catch (err) {
      setState({ status: "anon", error: err instanceof ApiError && err.status === 401 ? undefined : err });
      return null;
    }
  }, [setLocale]);

  useEffect(() => {
    void refresh();
    setUnauthorizedHandler(() => setState({ status: "anon" }));
    return () => setUnauthorizedHandler(null);
  }, [refresh]);

  const logout = useCallback(async () => {
    // A signed-out browser (a shared tablet) must stop getting this parent's notifications.
    // Unsubscribe the browser even if the id was lost; the server row then goes as gone.
    await disablePush(localStorage.getItem(PUSH_ID_KEY)).catch(() => undefined);
    localStorage.removeItem(PUSH_ID_KEY);
    try {
      await api.post("/auth/logout");
    } finally {
      setState({ status: "anon" });
    }
  }, []);

  const saveLocale = useCallback(
    (l: Locale) => {
      setLocale(l);
      if (state.status === "in" && l !== locale) {
        void api.patch("/me", { locale: l }).catch(() => undefined);
        setState({ status: "in", me: { ...state.me, user: { ...state.me.user, locale: l } } });
      }
    },
    [setLocale, state, locale],
  );

  const value = useMemo(() => ({ state, refresh, logout, saveLocale }), [state, refresh, logout, saveLocale]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

/** The signed-in user. Only use below <RequireAuth>. */
export function useMe(): Me {
  const { state } = useSession();
  if (state.status !== "in") throw new Error("not signed in");
  return state.me;
}

/** True when this server pairs iPhones (`iosPairing` in /me). False outside a session. */
export function useIosPairing(): boolean {
  const v = useContext(SessionContext);
  return v?.state.status === "in" && v.state.me.iosPairing === true;
}
