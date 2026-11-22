// SPDX-License-Identifier: Apache-2.0
//
// Live updates in the app (docs/live-updates.md). One LiveClient runs while the parent is signed
// in, the setting is on and the app is in the foreground; in the background push takes over.
// Screens keep their own load functions: useLiveRefresh only says when to call them again, and
// keeps polling as before while the connection is not live.
import { useFocusEffect } from "expo-router";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  LiveClient,
  type LiveEvent,
  type LiveEventType,
  type LiveStatus,
  liveMatches,
  pollInterval,
  type Transport,
} from "@plainphone/shared/live-events";
import { DEFAULT_LIVE_SETTINGS, loadLiveSettings, type LiveSettings, saveLiveSetting } from "./live-settings";
import { xhrTransport } from "./live-transport";
import { useSession } from "./session";

/** Several events in a row (a burst of messages) cause one refetch. */
export const LIVE_DEBOUNCE_MS = 250;

interface LiveValue {
  status: LiveStatus;
  settings: LiveSettings;
  setSetting: (key: keyof LiveSettings, on: boolean) => void;
  onEvent: (fn: (e: LiveEvent) => void) => () => void;
  onRefetch: (fn: () => void) => () => void;
}

const none = () => () => undefined;
// Outside a provider (a screen rendered on its own) nothing is live and screens poll as before.
const OFFLINE: LiveValue = { status: "off", settings: DEFAULT_LIVE_SETTINGS, setSetting: () => undefined, onEvent: none, onRefetch: none };

const LiveContext = createContext<LiveValue>(OFFLINE);

export function LiveProvider({ children, transport }: { children: ReactNode; transport?: Transport }) {
  const { state, serverUrl } = useSession();
  const signedIn = state.status === "in";
  const [settings, setSettings] = useState(DEFAULT_LIVE_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(() => AppState.currentState === "active");
  const [status, setStatus] = useState<LiveStatus>("off");
  const eventFns = useRef(new Set<(e: LiveEvent) => void>());
  const refetchFns = useRef(new Set<() => void>());

  useEffect(() => {
    let alive = true;
    void loadLiveSettings().then((s) => {
      if (!alive) return;
      setSettings(s);
      setLoaded(true);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);

  // One client per sign-in and server, so it keeps its lastEventId across the background.
  const on = signedIn && loaded && settings.enabled;
  const client = useRef<LiveClient | null>(null);
  useEffect(() => {
    if (!on) return;
    client.current = new LiveClient({
      apiBase: `${serverUrl}/api`,
      transport: transport ?? xhrTransport(),
      onStatus: setStatus,
      onEvent: (e) => eventFns.current.forEach((fn) => fn(e)),
      onRefetch: () => refetchFns.current.forEach((fn) => fn()),
    });
    return () => {
      client.current = null;
    };
  }, [on, serverUrl, transport]);

  // Declared after the effect above, so it sees the new client; paused in the background.
  useEffect(() => {
    if (!on || !active) return;
    const c = client.current;
    c?.start();
    return () => c?.stop();
  }, [on, serverUrl, transport, active]);

  const setSetting = useCallback((key: keyof LiveSettings, value: boolean) => {
    setSettings((s) => ({ ...s, [key]: value }));
    void saveLiveSetting(key, value).catch(() => undefined);
  }, []);
  const onEvent = useCallback((fn: (e: LiveEvent) => void) => {
    eventFns.current.add(fn);
    return () => void eventFns.current.delete(fn);
  }, []);
  const onRefetch = useCallback((fn: () => void) => {
    refetchFns.current.add(fn);
    return () => void refetchFns.current.delete(fn);
  }, []);

  const shown: LiveStatus = on && active ? status : "off";
  const value = useMemo(() => ({ status: shown, settings, setSetting, onEvent, onRefetch }), [shown, settings, setSetting, onEvent, onRefetch]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveValue {
  return useContext(LiveContext);
}

export function useLiveStatus(): LiveStatus {
  return useLive().status;
}

/** Calls `handler` for each live event of these types (for this phone, when `phoneId` is given). */
export function useLiveEvent(types: readonly LiveEventType[], phoneId: string | undefined, handler: (e: LiveEvent) => void) {
  const { onEvent } = useLive();
  const latest = useRef({ types, phoneId, handler });
  useEffect(() => {
    latest.current = { types, phoneId, handler };
  });
  useEffect(
    () => onEvent((e) => {
      const l = latest.current;
      if (liveMatches(e, l.types, l.phoneId)) l.handler(e);
    }),
    [onEvent],
  );
}

/**
 * Runs `refresh` shortly after a matching event, after a "refetch", and on a timer: every
 * `normalPollMs` while not live (today's behaviour), only as a slow safety net while live.
 * 0 means no timer. The timer runs while the screen has focus.
 */
export function useLiveRefresh(
  types: readonly LiveEventType[],
  phoneId: string | undefined,
  refresh: () => unknown,
  normalPollMs: number,
) {
  const { status, onRefetch } = useLive();
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const run = useCallback(() => {
    void Promise.resolve(latest.current()).catch(() => undefined);
  }, []);
  const soon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(run, LIVE_DEBOUNCE_MS);
  }, [run]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useLiveEvent(types, phoneId, soon);
  useEffect(() => onRefetch(soon), [onRefetch, soon]);

  const every = pollInterval(status, normalPollMs);
  useFocusEffect(useCallback(() => {
    if (normalPollMs <= 0) return;
    const id = setInterval(run, every);
    return () => clearInterval(id);
  }, [normalPollMs, every, run]));
}
