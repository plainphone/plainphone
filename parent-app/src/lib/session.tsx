// SPDX-License-Identifier: Apache-2.0
//
// The signed-in parent. The session token (pp_s_…) lives in the Keychain/Keystore and
// is sent as a Bearer token; the app never uses cookies.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, client, setSessionToken, setUnauthorizedHandler, unwrap } from "../api/client";
import type { Locale, Me } from "../api/models";
import { useI18n } from "../i18n/I18n";
import { getItem, removeItem, setItem } from "./storage";

const TOKEN_KEY = "pp.session";

type State = { status: "loading" } | { status: "anon"; error?: unknown } | { status: "in"; me: Me };

interface SessionValue {
  state: State;
  refresh: () => Promise<Me | null>;
  /** Exchanges a magic-link token for a session. Throws ApiError(400) for a used/expired link. */
  verify: (linkToken: string) => Promise<Me | null>;
  logout: () => Promise<void>;
  saveLocale: (l: Locale) => void;
  /** Where to go after login, e.g. a pairing link opened while signed out. */
  next: string | null;
  setNext: (path: string | null) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

// One verify per link token, also when effects run twice in development.
const inflight = new Map<string, Promise<{ sessionToken?: string }>>();

export function SessionProvider({ children }: { children: ReactNode }) {
  const { setLocale, locale } = useI18n();
  const [state, setState] = useState<State>({ status: "loading" });
  const [next, setNext] = useState<string | null>(null);
  const localeRef = useRef(locale);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  const signOutLocally = useCallback(async () => {
    setSessionToken(null);
    await removeItem(TOKEN_KEY).catch(() => undefined);
    setState({ status: "anon" });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await unwrap<Me>(client.GET("/me"));
      setState({ status: "in", me });
      if (me.user.locale === "en" || me.user.locale === "da") setLocale(me.user.locale);
      return me;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) await signOutLocally();
      else setState({ status: "anon", error: err });
      return null;
    }
  }, [setLocale, signOutLocally]);

  useEffect(() => {
    setUnauthorizedHandler(() => void signOutLocally());
    void (async () => {
      const saved = await getItem(TOKEN_KEY).catch(() => null);
      if (!saved) {
        setState({ status: "anon" });
        return;
      }
      setSessionToken(saved);
      await refresh();
    })();
    return () => setUnauthorizedHandler(null);
  }, [refresh, signOutLocally]);

  const verify = useCallback(
    async (linkToken: string) => {
      let p = inflight.get(linkToken);
      if (!p) {
        p = unwrap<{ sessionToken?: string }>(
          client.POST("/auth/verify", { body: { token: linkToken, locale: localeRef.current, client: "native" } }),
        );
        inflight.set(linkToken, p);
      }
      const out = await p;
      if (!out.sessionToken) throw new ApiError(500, "no session token");
      setSessionToken(out.sessionToken);
      await setItem(TOKEN_KEY, out.sessionToken);
      return refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await unwrap(client.POST("/auth/logout"));
    } catch {
      // signed out locally either way
    } finally {
      await signOutLocally();
    }
  }, [signOutLocally]);

  const saveLocale = useCallback(
    (l: Locale) => {
      setLocale(l);
      if (state.status === "in" && l !== state.me.user.locale) {
        void unwrap(client.PATCH("/me", { body: { locale: l } })).catch(() => undefined);
        setState({ status: "in", me: { ...state.me, user: { ...state.me.user, locale: l } } });
      }
    },
    [setLocale, state],
  );

  const value = useMemo(
    () => ({ state, refresh, verify, logout, saveLocale, next, setNext }),
    [state, refresh, verify, logout, saveLocale, next],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

/** The signed-in user. Only use on screens behind the signed-in layout. */
export function useMe(): Me {
  const { state } = useSession();
  if (state.status !== "in") throw new Error("not signed in");
  return state.me;
}
