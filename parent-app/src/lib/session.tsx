// SPDX-License-Identifier: Apache-2.0
//
// The signed-in parent. The session token (pp_s_…) lives in the Keychain/Keystore and
// is sent as a Bearer token; the app never uses cookies.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, client, getSessionToken, setSessionToken, setUnauthorizedHandler, unwrap } from "../api/client";
import type { Locale, Me } from "../api/models";
import { useI18n } from "../i18n/I18n";
import { usePushRegistration, withPushRegistration } from "./notifications";
import { loadPendingInvite } from "./pendingInvite";
import { getItem, removeItem, setItem } from "./storage";

const TOKEN_KEY = "pp.session";
const NEXT_KEY = "pp.next"; // where to go after login; survives the app being closed during the mail round trip

/** Only paths inside the app. */
function safePath(p: string | null): string | null {
  return p && p.startsWith("/") && !p.startsWith("//") ? p : null;
}

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
  /** Where to go now that the user is signed in: a pending invite first, then `next`. Clears `next`. */
  takeNext: () => Promise<string>;
}

const SessionContext = createContext<SessionValue | null>(null);

// One verify per link token, also when effects run twice in development.
const inflight = new Map<string, Promise<Me | null>>();

export function SessionProvider({ children }: { children: ReactNode }) {
  const { setLocale, locale } = useI18n();
  const [state, setState] = useState<State>({ status: "loading" });
  usePushRegistration(state.status === "in" ? getSessionToken() : null, locale);
  const [next, setNextState] = useState<string | null>(null);
  const setNext = useCallback((path: string | null) => {
    const p = safePath(path);
    setNextState(p);
    void (p ? setItem(NEXT_KEY, p) : removeItem(NEXT_KEY)).catch(() => undefined);
  }, []);
  // One answer per sign-in, shared by every screen that asks (login and the link screen
  // can both be mounted), so the stored path is read once and never lost to a race.
  const taking = useRef<Promise<string> | null>(null);
  const takeNext = useCallback(() => {
    taking.current ??= (async () => {
      const saved = safePath(await getItem(NEXT_KEY).catch(() => null));
      setNextState(null);
      await removeItem(NEXT_KEY).catch(() => undefined);
      if (await loadPendingInvite()) return "/invite";
      return saved ?? "/";
    })();
    return taking.current;
  }, []);
  useEffect(() => {
    if (state.status === "anon") taking.current = null;
  }, [state.status]);
  const linkSignIn = useRef(false);
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
    const used = getSessionToken();
    try {
      const me = await unwrap<Me>(client.GET("/me"));
      // A login link may have replaced the token while this was in flight.
      if (getSessionToken() !== used) return null;
      setState({ status: "in", me });
      if (me.user.locale === "en" || me.user.locale === "da") setLocale(me.user.locale);
      return me;
    } catch (err) {
      if (getSessionToken() !== used) return null;
      if (err instanceof ApiError && err.status === 401) await signOutLocally();
      else setState({ status: "anon", error: err });
      return null;
    }
  }, [setLocale, signOutLocally]);

  /** Signs in with the token saved in the keychain, if any. */
  const restore = useCallback(async () => {
    const remembered = safePath(await getItem(NEXT_KEY).catch(() => null));
    if (remembered) setNextState(remembered);
    const saved = await getItem(TOKEN_KEY).catch(() => null);
    // A login link may already be signing in while the keychain was read.
    if (linkSignIn.current) return;
    if (!saved) {
      setSessionToken(null);
      setState({ status: "anon" });
      return;
    }
    setSessionToken(saved);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    setUnauthorizedHandler((rejected) => {
      if (rejected === getSessionToken()) void signOutLocally();
    });
    // Reading the keychain at start-up is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void restore();
    return () => setUnauthorizedHandler(null);
  }, [restore, signOutLocally]);

  const verify = useCallback(
    (linkToken: string) => {
      const existing = inflight.get(linkToken);
      if (existing) return existing;

      linkSignIn.current = true;
      const signIn = withPushRegistration(async () => {
        // A new sign-in gets a fresh answer from takeNext(), also without passing through anon.
        taking.current = null;
        let sessionToken: string;
        try {
          const previousSession = getSessionToken() ?? await getItem(TOKEN_KEY);
          const out = await unwrap<{ sessionToken?: string }>(client.POST("/auth/verify", {
            ...(previousSession ? { headers: { authorization: `Bearer ${previousSession}` } } : {}),
            body: {
              token: linkToken,
              locale: localeRef.current,
              client: "native",
            },
          }));
          if (!out.sessionToken) throw new ApiError(500, "no session token");
          sessionToken = out.sessionToken;
        } catch (err) {
          // A used or expired link: carry on with the saved session, if there is one.
          linkSignIn.current = false;
          if (!getSessionToken()) await restore();
          throw err;
        }
        setSessionToken(sessionToken);
        await setItem(TOKEN_KEY, sessionToken);
        return refresh();
      }).finally(() => inflight.delete(linkToken));
      inflight.set(linkToken, signIn);
      return signIn;
    },
    [refresh, restore],
  );

  const logout = useCallback(() => withPushRegistration(async () => {
    try {
      await unwrap(client.POST("/auth/logout"));
    } catch (err) {
      // An expired or revoked session cannot receive push. Other failures can be retried.
      if (!(err instanceof ApiError && err.status === 401)) throw err;
    }
    await signOutLocally();
  }), [signOutLocally]);

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
    () => ({ state, refresh, verify, logout, saveLocale, next, setNext, takeNext }),
    [state, refresh, verify, logout, saveLocale, next, setNext, takeNext],
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
