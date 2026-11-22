// SPDX-License-Identifier: Apache-2.0
import { isLanguage } from "@plainphone/i18n/phone-language";
import { pickHousehold } from "@plainphone/shared/household";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
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

/** Set when this browser asks for a login link, so a link opened here soon after is used without a question. */
export const LINK_ASKED_KEY = "pp.linkAsked";
/** How long a login link works (the server's magic-link lifetime). */
const LINK_LIFETIME_MS = 15 * 60 * 1000;

export function noteLinkAsked() {
  try {
    localStorage.setItem(LINK_ASKED_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

/** Whether this browser asked for a login link that can still be valid. */
export function linkAskedHere(): boolean {
  try {
    const at = Number(localStorage.getItem(LINK_ASKED_KEY));
    const age = Date.now() - at;
    return at > 0 && age >= 0 && age < LINK_LIFETIME_MS;
  } catch {
    return false;
  }
}

/** The household a parent in more than one has picked (an id, not a credential). */
export const HOUSEHOLD_KEY = "pp.household";
const householdListeners = new Set<() => void>();

function savedHousehold(): string | null {
  try {
    return localStorage.getItem(HOUSEHOLD_KEY);
  } catch {
    return null;
  }
}

function subscribeHousehold(listener: () => void) {
  householdListeners.add(listener);
  return () => void householdListeners.delete(listener);
}

export function chooseHousehold(id: string) {
  try {
    localStorage.setItem(HOUSEHOLD_KEY, id);
  } catch {
    // ignore
  }
  householdListeners.forEach((listener) => listener());
}

/** The inbox signature name (components/FamilyInbox.tsx); a display name, not a credential. */
export const INBOX_NAME_KEY = "pp.inboxName";

/** Forgets what this browser kept for the account that signs out, so the next person does not inherit it. */
export function clearAccountState() {
  const kept: [() => Storage, string[]][] = [
    [() => sessionStorage, [NEXT_KEY, INVITE_KEY]],
    [() => localStorage, [INBOX_NAME_KEY, LINK_ASKED_KEY, PUSH_ID_KEY, HOUSEHOLD_KEY]],
  ];
  for (const [storage, keys] of kept) {
    for (const key of keys) {
      try {
        storage().removeItem(key);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * A session that expired (or was replaced) leaves this browser's push subscription behind, bound to
 * the previous account. If the signed-in account does not list it, someone else signed in here:
 * unsubscribe the browser so it stops showing the previous parent's alerts. A failed lookup keeps it.
 */
async function dropForeignPush() {
  let id: string | null = null;
  try {
    id = localStorage.getItem(PUSH_ID_KEY);
    if (!id) return;
    const { subscriptions } = await api.get<{ subscriptions: { id: string }[] }>("/notifications");
    if (subscriptions.some((s) => s.id === id)) return;
    await disablePush(null);
    localStorage.removeItem(PUSH_ID_KEY);
  } catch {
    // Keep the subscription when we could not tell.
  }
}

/** `signedOut`: the user logged out here, so the page they were on is no place to return to. */
type State = { status: "loading" } | { status: "anon"; error?: unknown; signedOut?: boolean } | { status: "in"; me: Me };

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
      void dropForeignPush();
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
    // Only the server can end the HttpOnly session cookie. If the call fails, this browser is still
    // signed in, so the caller says so instead of showing the login page (a shared tablet), and
    // notifications stay on: a parent who stays signed in here must still hear an SOS.
    try {
      await api.post("/auth/logout");
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) throw err;
    }
    // A signed-out browser (a shared tablet) must stop getting this parent's notifications.
    // The session is gone, so only the browser unsubscribes; the server drops the row as gone
    // the next time it sends to it.
    await disablePush(null).catch(() => undefined);
    localStorage.removeItem(PUSH_ID_KEY);
    clearAccountState();
    setState({ status: "anon", signedOut: true });
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

/**
 * The household a new phone goes into: the first one, the same the Household page shows.
 * Without it the server picks any of the parent's households, which after an accepted
 * invitation can be someone else's.
 */
export function useHouseholdId(): string | undefined {
  const v = useContext(SessionContext);
  const saved = useSyncExternalStore(subscribeHousehold, savedHousehold);
  return v?.state.status === "in" ? pickHousehold(v.state.me.households, saved)?.id : undefined;
}

/** The household the pages show: the one the parent picked, else the first. Only below <RequireAuth>. */
export function useActiveHousehold(): Me["households"][number] | undefined {
  const { state } = useSession();
  const saved = useSyncExternalStore(subscribeHousehold, savedHousehold);
  return state.status === "in" ? pickHousehold(state.me.households, saved) : undefined;
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
