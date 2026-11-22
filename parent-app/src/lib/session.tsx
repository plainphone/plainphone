// SPDX-License-Identifier: Apache-2.0
//
// The signed-in parent. The session token (pp_s_…) lives in the Keychain/Keystore and
// is sent as a Bearer token; the app never uses cookies.
import { AppState } from "react-native";
import { isLanguage } from "@plainphone/i18n/phone-language";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ApiError, client, getSessionToken, setSessionToken, setUnauthorizedHandler, unwrap, configureApiServer } from "../api/client";
import type { Locale, Me } from "../api/models";
import { useI18n } from "../i18n/I18n";
import { checkServer, HOSTED_SERVER, BUILD_SERVER, normalizeServerUrl, restoreServer, saveServer, SERVER_URL } from "./config";
import { clearLocalNotifications, syncNativePush, watchNativePush } from "./notifications";
import { logoutNativeSession } from "./push-registration";
import { clearPendingInvite, forgetAcceptedInvites, loadPendingInvite } from "./pendingInvite";
import { forgetHouseholdChoice, getHouseholdChoice, loadHouseholdChoice, subscribeHouseholdChoice } from "./household-choice";
import { pickHousehold } from "@plainphone/shared/household";
import { rememberLogout, retryPendingLogouts, signOutOnServer } from "./pending-logout";
import { getItem, removeItem, setItem } from "./storage";

const TOKEN_KEY = "pp.session";
const CUSTOM_TOKEN_KEY = "pp.customSession";
async function readSession() {
  const raw = await getItem(SERVER_URL === BUILD_SERVER ? TOKEN_KEY : CUSTOM_TOKEN_KEY);
  if (!raw || SERVER_URL === BUILD_SERVER) return raw;
  const saved = JSON.parse(raw) as { server?: string; token?: string };
  return saved.server === SERVER_URL && typeof saved.token === "string" ? saved.token : null;
}

function writeSession(server: string, token: string) {
  return server === BUILD_SERVER ? setItem(TOKEN_KEY, token)
    : setItem(CUSTOM_TOKEN_KEY, JSON.stringify({ server, token }));
}

const NEXT_KEY = "pp.next"; // where to go after login; survives the app being closed during the mail round trip

/** Only paths inside the app. */
function safePath(p: string | null): string | null {
  return p && p.startsWith("/") && !p.startsWith("//") ? p : null;
}

type State = { status: "loading" } | { status: "anon"; error?: unknown } | { status: "in"; me: Me };

interface SessionValue {
  state: State;
  serverUrl: string;
  serverChanging: boolean;
  changeServer: (value: string | null) => Promise<void>;
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
const inflight = new Map<string, Promise<{ sessionToken?: string }>>();

export function SessionProvider({ children }: { children: ReactNode }) {
  const { setLocale, locale } = useI18n();
  const [state, setState] = useState<State>({ status: "loading" });
  const [serverUrl, setServerUrl] = useState(SERVER_URL);
  const [serverReady, setServerReady] = useState(false);
  const [serverChanging, setServerChanging] = useState(false);
  const switching = useRef(false);
  const serverRevision = useRef(0);
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
    await removeItem(SERVER_URL === BUILD_SERVER ? TOKEN_KEY : CUSTOM_TOKEN_KEY).catch(() => undefined);
    setState({ status: "anon" });
    await clearLocalNotifications().catch(() => undefined);
  }, []);

  const refresh = useCallback(async () => {
    const used = getSessionToken();
    try {
      const me = await unwrap<Me>(client.GET("/me"));
      // A login link may have replaced the token while this was in flight.
      if (getSessionToken() !== used) return null;
      setState({ status: "in", me });
      if (isLanguage(me.user.locale)) setLocale(me.user.locale);
      void syncNativePush(isLanguage(me.user.locale) ? me.user.locale : "en");
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
    const server = SERVER_URL;
    const saved = await readSession().catch(() => null);
    // A login link may already be signing in while the keychain was read.
    if (linkSignIn.current || switching.current || server !== SERVER_URL) return;
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
    void restoreServer().then(async () => {
      configureApiServer();
      setServerUrl(SERVER_URL);
      setServerReady(true);
      await restore();
      void retryPendingLogouts();
    }).catch((error: unknown) => {
      setSessionToken(null);
      setServerReady(true);
      setState({ status: "anon", error });
    });
    return () => setUnauthorizedHandler(null);
  }, [restore, signOutLocally]);

  // An app that stays in the background for days would otherwise only retry an offline logout
  // when it is started again.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void retryPendingLogouts();
    });
    return () => sub.remove();
  }, []);

  const verify = useCallback(
    async (linkToken: string) => {
      if (switching.current) return null;
      const origin = SERVER_URL;
      const revision = serverRevision.current;
      linkSignIn.current = true;
      // A new sign-in gets a fresh answer from takeNext(), also without passing through anon.
      taking.current = null;
      let p = inflight.get(linkToken);
      if (!p) {
        p = unwrap<{ sessionToken?: string }>(
          client.POST("/auth/verify", { body: { token: linkToken, locale: localeRef.current, client: "native" } }),
        );
        inflight.set(linkToken, p);
        // A failed attempt (offline, say) can be retried with the same link.
        p.catch(() => { if (inflight.get(linkToken) === p) inflight.delete(linkToken); });
      }
      let out: { sessionToken?: string };
      try {
        out = await p;
        if (!out.sessionToken) throw new ApiError(500, "no session token");
      } catch (err) {
        if (revision !== serverRevision.current) return null;
        // A used or expired link: carry on with the saved session, if there is one.
        linkSignIn.current = false;
        if (!getSessionToken()) await restore();
        throw err;
      }
      if (switching.current || revision !== serverRevision.current) return null;
      // The session this link replaces would otherwise stay valid on the server, with its push alerts.
      const previous = getSessionToken();
      if (previous && previous !== out.sessionToken) void signOutOnServer(origin, previous);
      setSessionToken(out.sessionToken);
      await writeSession(origin, out.sessionToken);
      if (switching.current || revision !== serverRevision.current) return null;
      return refresh();
    },
    [refresh, restore],
  );

  const signedIn = state.status === "in";
  useEffect(() => {
    if (signedIn) return watchNativePush(locale);
  }, [signedIn, locale]);

  const logout = useCallback(async () => {
    const server = SERVER_URL;
    const token = getSessionToken();
    try {
      await logoutNativeSession();
    } catch {
      // Signed out locally either way; the server hears about it when the app is online again.
      if (token) await rememberLogout(server, token).catch(() => undefined);
    } finally {
      // The next person to sign in here must not inherit this account's destination or invitation.
      inflight.clear();
      setNext(null);
      forgetAcceptedInvites();
      void forgetHouseholdChoice();
      await clearPendingInvite().catch(() => undefined);
      await signOutLocally();
    }
  }, [signOutLocally, setNext]);

  const changeServer = useCallback(async (value: string | null) => {
    if (switching.current) return;
    const target = value === null ? HOSTED_SERVER : normalizeServerUrl(value);
    if (target === SERVER_URL) return;
    switching.current = true;
    setServerChanging(true);
    try {
      if (value !== null) await checkServer(target);
      // Switching signs out here, so it must also end the session on the old server: otherwise
      // that server keeps the session and keeps sending this device the household's alerts.
      const oldToken = getSessionToken();
      if (oldToken) {
        try {
          await logoutNativeSession();
        } catch {
          await rememberLogout(SERVER_URL, oldToken).catch(() => undefined);
        }
        await clearLocalNotifications().catch(() => undefined);
      }
      serverRevision.current++;
      setSessionToken(null);
      setState({ status: "anon" });
      await removeItem(TOKEN_KEY);
      await removeItem(CUSTOM_TOKEN_KEY);
      await removeItem(NEXT_KEY);
      forgetAcceptedInvites();
      void forgetHouseholdChoice();
      await clearPendingInvite();
      await saveServer(target);
      inflight.clear();
      taking.current = null;
      linkSignIn.current = false;
      setNextState(null);
      configureApiServer();
      setServerUrl(target);
    } finally {
      switching.current = false;
      setServerChanging(false);
    }
  }, []);

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
    () => ({ state, serverUrl, serverChanging, changeServer, refresh, verify, logout, saveLocale, next, setNext, takeNext }),
    [state, serverUrl, serverChanging, changeServer, refresh, verify, logout, saveLocale, next, setNext, takeNext],
  );
  return <SessionContext.Provider value={value}>{serverReady ? children : null}</SessionContext.Provider>;
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

/** The household the screens show: the one the parent picked, else the first. Only behind the signed-in layout. */
export function useActiveHousehold(): Me["households"][number] | undefined {
  const me = useMe();
  const chosen = useSyncExternalStore(subscribeHouseholdChoice, getHouseholdChoice);
  useEffect(() => {
    void loadHouseholdChoice();
  }, []);
  return pickHousehold(me.households, chosen);
}

/** True when this server pairs iPhones (`iosPairing` in /me). False outside a session. */
export function useIosPairing(): boolean {
  const v = useContext(SessionContext);
  return v?.state.status === "in" && v.state.me.iosPairing === true;
}
