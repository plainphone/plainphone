// SPDX-License-Identifier: Apache-2.0
//
// Live updates in the PWA (docs/live-updates.md): one EventSource per tab, shared by every view.
// The platform-free part is in live-events.ts. Views keep their own refresh function and polling;
// `useLiveRefresh` adds "refresh now" on a matching event and slows the polling down while live.

import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  LIVE_EVENT_TYPES,
  type LiveEvent,
  LiveClient,
  type LiveEventType,
  type LiveStatus,
  liveMatches,
  pollInterval,
  type Transport,
} from "@plainphone/shared/live-events";
import { LIVE_KEY, useLiveSetting } from "./live-settings";

/** Bursts (a position every few seconds, several answers at once) make one refetch. */
export const LIVE_DEBOUNCE_MS = 250;

const EVENT_NAMES = ["ready", "refetch", "bye", "ping", ...LIVE_EVENT_TYPES];

/** EventSource as a Transport. The cookie goes along: same origin. */
export const eventSourceTransport: Transport = (url, h) => {
  const es = new EventSource(url);
  let opened = false;
  let closed = false;
  es.onopen = () => {
    opened = true;
    h.onOpen();
  };
  for (const name of EVENT_NAMES) {
    es.addEventListener(name, (ev) => {
      const m = ev as MessageEvent<string>;
      h.onMessage(name, typeof m.data === "string" ? m.data : "", m.lastEventId || undefined);
    });
  }
  es.onerror = () => {
    if (closed) return;
    // The browser retries by itself, but LiveClient owns the backoff, so close it here. Closed
    // before it ever opened means the server answered with something that is not a stream (a
    // refusal, or a server without live updates): say so, to poll instead of retrying fast.
    const refused = !opened && es.readyState === 2;
    closed = true;
    es.close();
    h.onError(refused ? 503 : undefined);
  };
  return () => {
    closed = true;
    es.close();
  };
};

interface LiveValue {
  status: LiveStatus;
  subscribe(fn: (e: LiveEvent) => void): () => void;
  /** Everything may have changed (a missed event, a fresh connection after a gap, a refetch). */
  subscribeRefetch(fn: () => void): () => void;
}

// Without a provider (a page rendered alone) nothing is live: the views just poll.
const OFF: LiveValue = { status: "off", subscribe: () => () => undefined, subscribeRefetch: () => () => undefined };
const LiveContext = createContext<LiveValue>(OFF);

function useVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

/**
 * Connects while someone is signed in, the setting is on and the tab is visible. A hidden tab
 * disconnects (push covers it) and, on return, resumes or refetches through the same client.
 */
export function LiveProvider({ signedIn, children }: { signedIn: boolean; children: ReactNode }) {
  const [enabled] = useLiveSetting(LIVE_KEY);
  const visible = useVisible();
  const [status, setStatus] = useState<LiveStatus>("off");
  const listeners = useRef(new Set<(e: LiveEvent) => void>());
  const refetchers = useRef(new Set<() => void>());
  const client = useRef<LiveClient | null>(null);
  const wanted = signedIn && enabled;

  // One client per sign-in, so a new user never resumes the previous one's stream.
  useEffect(() => {
    if (!wanted) return;
    if (typeof EventSource === "undefined") {
      setStatus("fallback");
      return () => setStatus("off");
    }
    const c = new LiveClient({
      apiBase: "/api",
      transport: eventSourceTransport,
      onStatus: setStatus,
      onEvent: (e) => listeners.current.forEach((fn) => fn(e)),
      onRefetch: () => refetchers.current.forEach((fn) => fn()),
    });
    client.current = c;
    return () => {
      c.stop();
      client.current = null;
      setStatus("off");
    };
  }, [wanted]);

  useEffect(() => {
    const c = client.current;
    if (!c || !visible) return;
    c.start();
    return () => c.stop();
  }, [wanted, visible]);

  // Stable, so a status change does not make every view resubscribe (and lose its debounce).
  const bus = useMemo(
    () => ({
      subscribe: (fn: (e: LiveEvent) => void) => {
        listeners.current.add(fn);
        return () => void listeners.current.delete(fn);
      },
      subscribeRefetch: (fn: () => void) => {
        refetchers.current.add(fn);
        return () => void refetchers.current.delete(fn);
      },
    }),
    [],
  );
  const value = useMemo<LiveValue>(() => ({ status, ...bus }), [status, bus]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLiveStatus(): LiveStatus {
  return useContext(LiveContext).status;
}

/** Calls `handler` for each live event of these types (for `phoneId`, or any phone when undefined). */
export function useLiveEvent(types: readonly LiveEventType[], phoneId: string | undefined, handler: (e: LiveEvent) => void) {
  const { subscribe } = useContext(LiveContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const key = types.join(",");
  useEffect(() => {
    const list = key.split(",") as LiveEventType[];
    return subscribe((e) => {
      if (liveMatches(e, list, phoneId)) handlerRef.current(e);
    });
  }, [subscribe, key, phoneId]);
}

/**
 * Keeps a view fresh: refresh on a matching event (debounced), when everything may have changed,
 * when the tab comes back, and on a timer. The timer is the old polling: as before while not live,
 * a slow safety net while live. `normalPollMs` null means the view never polled. `refresh` gets a
 * function that says whether this subscription is still current, for a response that arrives late.
 */
export function useLiveRefresh(
  types: readonly LiveEventType[],
  phoneId: string | undefined,
  refresh: (isCurrent: () => boolean) => unknown,
  normalPollMs: number | null,
  opts: { poll?: boolean; enabled?: boolean } = {},
) {
  const { status, subscribe, subscribeRefetch } = useContext(LiveContext);
  const { poll = true, enabled = true } = opts;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const key = types.join(",");

  useEffect(() => {
    if (!enabled) return;
    const list = key.split(",") as LiveEventType[];
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const isCurrent = () => current;
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void refreshRef.current(isCurrent);
      }, LIVE_DEBOUNCE_MS);
    };
    const offEvent = subscribe((e) => {
      if (liveMatches(e, list, phoneId)) schedule();
    });
    const offRefetch = subscribeRefetch(schedule);
    const onVisible = () => {
      if (document.visibilityState === "visible") schedule();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      current = false;
      if (timer !== undefined) clearTimeout(timer);
      offEvent();
      offRefetch();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, subscribe, subscribeRefetch, key, phoneId]);

  useEffect(() => {
    if (!enabled || !poll || normalPollMs === null) return;
    let current = true;
    const id = setInterval(() => {
      if (!document.hidden) void refreshRef.current(() => current);
    }, pollInterval(status, normalPollMs));
    return () => {
      current = false;
      clearInterval(id);
    };
  }, [enabled, poll, normalPollMs, status]);
}
