// SPDX-License-Identifier: Apache-2.0
//
// Live updates (docs/live-updates.md): the client side of GET /api/events, shared by the PWA and
// the parent app (@plainphone/shared). Platform-free: the
// PWA plugs in EventSource, the app a small XMLHttpRequest reader. This file holds what both do
// the same way: the event names, the stream parser, reconnecting with backoff, noticing a dead
// connection, and telling the views what to refetch. Events carry ids only; views refetch
// through the normal API.

export const LIVE_EVENT_TYPES = [
  "sos.created",
  "sos.updated",
  "request.created",
  "request.answered",
  "location.updated",
  "safety.updated",
  "inbox.message",
  "phone.status",
] as const;

export type LiveEventType = (typeof LIVE_EVENT_TYPES)[number];

export interface LiveEvent {
  type: LiveEventType;
  phoneId: string;
  id?: string;
  kind?: "app" | "contact" | "more-time";
}

/**
 * "live": connected. "connecting": (re)connecting, polling meanwhile. "fallback": the server has no
 * live updates or refused (too many connections), so the views poll. "off": switched off or paused.
 */
export type LiveStatus = "off" | "connecting" | "live" | "fallback";

/** What a transport reports. `id` is the SSE id field when the message had one. */
export interface TransportHandlers {
  onOpen(): void;
  onMessage(event: string, data: string, id: string | undefined): void;
  /** `status` is the HTTP status when the server answered with something other than a stream. */
  onError(status?: number): void;
}

/** Opens one connection to `url` (lastEventId already in the query). Returns a close function. */
export type Transport = (url: string, handlers: TransportHandlers) => () => void;

/** The server pings every 25 s; nothing for this long means the connection is dead. */
export const LIVE_SILENCE_MS = 60_000;
/** Backoff after a failed connection: 1 s, 2 s, 4 s … capped, with jitter so tabs spread out. */
export const LIVE_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000] as const;
/** After a refusal (429/503) or a server without live updates: try again much later. */
export const LIVE_REFUSED_RETRY_MS = 5 * 60_000;

export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = LIVE_BACKOFF_MS[Math.min(attempt, LIVE_BACKOFF_MS.length - 1)]!;
  // ±20 %, so a server restart does not bring every client back in the same second.
  return Math.round(base * (0.8 + random() * 0.4));
}

export function isLiveEventType(t: string): t is LiveEventType {
  return (LIVE_EVENT_TYPES as readonly string[]).includes(t);
}

/** Parses an event's data; null for anything that is not a well-formed live event. */
export function parseLiveEvent(event: string, data: string): LiveEvent | null {
  if (!isLiveEventType(event)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.phoneId !== "string") return null;
  return {
    type: event,
    phoneId: r.phoneId,
    ...(typeof r.id === "string" ? { id: r.id } : {}),
    ...(r.kind === "app" || r.kind === "contact" || r.kind === "more-time" ? { kind: r.kind } : {}),
  };
}

/**
 * A text/event-stream parser for transports that get the raw text (the parent app). Feed it
 * chunks as they arrive; it calls `onMessage` per complete message. Follows the SSE format:
 * `event:`, `data:` (joined with newlines), `id:`, comments and `retry:` are skipped.
 */
export class SseParser {
  private buffer = "";
  private event = "";
  private data: string[] = [];
  private id: string | undefined;

  constructor(private readonly onMessage: (event: string, data: string, id: string | undefined) => void) {}

  push(chunk: string) {
    this.buffer += chunk;
    for (;;) {
      const nl = this.buffer.search(/\r\n|\r|\n/);
      if (nl < 0) return;
      // A chunk may end between the CR and the LF of one CRLF: wait, or the LF would read as a blank line.
      if (nl === this.buffer.length - 1 && this.buffer[nl] === "\r") return;
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + (this.buffer.startsWith("\r\n", nl) ? 2 : 1));
      this.line(line);
    }
  }

  private line(line: string) {
    if (line === "") {
      if (this.data.length || this.event) this.onMessage(this.event || "message", this.data.join("\n"), this.id);
      this.event = "";
      this.data = [];
      this.id = undefined;
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.event = value;
    else if (field === "data") this.data.push(value);
    else if (field === "id" && !value.includes("\0")) this.id = value;
  }
}

export interface LiveClientOptions {
  /** Base URL of the API, e.g. "/api" or "https://app.example.org/api". */
  apiBase: string;
  transport: Transport;
  onStatus?(status: LiveStatus): void;
  /** A live event for the views. */
  onEvent(e: LiveEvent): void;
  /** The client may have missed events (reconnect after a gap, server restart): reload everything. */
  onRefetch(): void;
  /** Injected for tests. */
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
  now?(): number;
  random?(): number;
}

/**
 * One live connection with reconnects. `start()` when the view is visible (the app in the
 * foreground), `stop()` when it is hidden; push covers the rest.
 */
export class LiveClient {
  private close?: () => void;
  private retry?: unknown;
  private watchdog?: unknown;
  private attempt = 0;
  private lastEventId: string | undefined;
  private lastHeard = 0;
  private running = false;
  /** True once a stream was open: the next "ready" after a reconnect without resume means a refetch. */
  private everConnected = false;
  status: LiveStatus = "off";

  constructor(private readonly o: LiveClientOptions) {}

  private get set() {
    return this.o.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  }
  private get clear() {
    return this.o.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }
  private now() {
    return this.o.now?.() ?? Date.now();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    this.connect();
  }

  stop() {
    this.running = false;
    this.teardown();
    if (this.retry !== undefined) this.clear(this.retry);
    this.retry = undefined;
    this.setStatus("off");
  }

  private setStatus(s: LiveStatus) {
    if (this.status === s) return;
    this.status = s;
    this.o.onStatus?.(s);
  }

  private teardown() {
    this.close?.();
    this.close = undefined;
    if (this.watchdog !== undefined) this.clear(this.watchdog);
    this.watchdog = undefined;
  }

  private url() {
    return `${this.o.apiBase}/events${this.lastEventId ? `?lastEventId=${encodeURIComponent(this.lastEventId)}` : ""}`;
  }

  private connect() {
    this.teardown();
    if (!this.running) return;
    if (this.status !== "fallback") this.setStatus("connecting");
    this.lastHeard = this.now();
    let opened = false;
    this.close = this.o.transport(this.url(), {
      onOpen: () => {
        opened = true;
        this.heard();
      },
      onMessage: (event, data, id) => this.message(event, data, id),
      onError: (status) => {
        // Not a stream at all: no live updates on this server, or too many connections. Poll.
        const refused = status !== undefined && status !== 0 && status !== 200;
        this.retryLater(refused || (!opened && this.attempt >= LIVE_BACKOFF_MS.length));
      },
    });
    this.armWatchdog();
  }

  private heard() {
    this.lastHeard = this.now();
  }

  private armWatchdog() {
    if (this.watchdog !== undefined) this.clear(this.watchdog);
    this.watchdog = this.set(() => {
      this.watchdog = undefined;
      if (!this.running) return;
      if (this.now() - this.lastHeard >= LIVE_SILENCE_MS) this.retryLater(false);
      else this.armWatchdog();
    }, LIVE_SILENCE_MS / 4);
  }

  private message(event: string, data: string, id: string | undefined) {
    this.heard();
    if (id) this.lastEventId = id;
    if (event === "ready") {
      let resumed = false;
      try {
        resumed = Boolean((JSON.parse(data) as { resumed?: boolean }).resumed);
      } catch {
        // A ready without data is a fresh start.
      }
      this.attempt = 0;
      // Polling filled the gap if it ran; a reconnect that could not resume reloads to be sure.
      if (this.everConnected && !resumed) this.o.onRefetch();
      this.everConnected = true;
      this.setStatus("live");
      return;
    }
    if (event === "refetch") {
      this.attempt = 0;
      this.everConnected = true;
      this.o.onRefetch();
      this.setStatus("live");
      return;
    }
    if (event === "bye") {
      // Signed out elsewhere: stop; the next API call shows the login page.
      this.stop();
      return;
    }
    const e = parseLiveEvent(event, data);
    if (e) this.o.onEvent(e);
  }

  private retryLater(refused: boolean) {
    this.teardown();
    if (!this.running) return;
    this.setStatus(refused ? "fallback" : this.everConnected ? "connecting" : "fallback");
    const delay = refused ? LIVE_REFUSED_RETRY_MS : backoffDelay(this.attempt++, this.o.random);
    if (this.retry !== undefined) this.clear(this.retry);
    this.retry = this.set(() => {
      this.retry = undefined;
      this.connect();
    }, delay);
  }
}

/** Does this event concern a view of `phoneId` that shows `types`? A phone-less view takes all phones. */
export function liveMatches(e: LiveEvent, types: readonly LiveEventType[], phoneId?: string): boolean {
  return types.includes(e.type) && (phoneId === undefined || e.phoneId === phoneId);
}

/** How often a view polls while not live, and while live (a slow safety net, since events can be lost). */
export function pollInterval(status: LiveStatus, normalMs: number): number {
  return status === "live" ? Math.max(normalMs * 5, 5 * 60_000) : normalMs;
}
