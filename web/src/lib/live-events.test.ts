// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backoffDelay,
  LIVE_BACKOFF_MS,
  LIVE_REFUSED_RETRY_MS,
  LIVE_SILENCE_MS,
  LiveClient,
  type LiveEvent,
  liveMatches,
  type LiveStatus,
  parseLiveEvent,
  pollInterval,
  SseParser,
  type TransportHandlers,
} from "@plainphone/shared/live-events";

describe("SseParser", () => {
  function parse(chunks: string[]) {
    const out: [string, string, string | undefined][] = [];
    const p = new SseParser((e, d, id) => out.push([e, d, id]));
    chunks.forEach((c) => p.push(c));
    return out;
  }

  it("reads event, data and id", () => {
    expect(parse(['id: 7\nevent: sos.created\ndata: {"a":1}\n\n'])).toEqual([["sos.created", '{"a":1}', "7"]]);
  });

  it("joins several data lines with a newline", () => {
    expect(parse(["event: x\ndata: one\ndata: two\n\n"])).toEqual([["x", "one\ntwo", undefined]]);
  });

  it("accepts CRLF and bare CR line ends", () => {
    expect(parse(["event: a\r\ndata: 1\r\n\r\n", "event: b\rdata: 2\r\rx"])).toEqual([
      ["a", "1", undefined],
      ["b", "2", undefined],
    ]);
  });

  it("skips comments and retry, and names a message without event 'message'", () => {
    expect(parse([": keep-alive\n\nretry: 3000\ndata: hi\n\n"])).toEqual([["message", "hi", undefined]]);
  });

  it("copes with chunk boundaries anywhere, even inside a CRLF", () => {
    const text = 'event: ready\r\ndata: {"resumed":true}\r\n\r\nevent: ping\ndata: {}\n\n';
    for (let cut = 1; cut < text.length; cut++) {
      expect(parse([text.slice(0, cut), text.slice(cut)]), `cut at ${cut}`).toEqual([
        ["ready", '{"resumed":true}', undefined],
        ["ping", "{}", undefined],
      ]);
    }
  });

  it("does not carry an id into the next message", () => {
    expect(parse(["id: 1\ndata: a\n\ndata: b\n\n"])).toEqual([
      ["message", "a", "1"],
      ["message", "b", undefined],
    ]);
  });
});

describe("helpers", () => {
  it("backoffDelay stays within +-20 % and caps", () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const base = LIVE_BACKOFF_MS[Math.min(attempt, LIVE_BACKOFF_MS.length - 1)]!;
      expect(backoffDelay(attempt, () => 0)).toBe(Math.round(base * 0.8));
      expect(backoffDelay(attempt, () => 1)).toBe(Math.round(base * 1.2));
      expect(backoffDelay(attempt, () => 0.5)).toBe(base);
    }
    expect(backoffDelay(500, () => 1)).toBeLessThanOrEqual(72_000);
  });

  it("parseLiveEvent keeps only well-formed events", () => {
    expect(parseLiveEvent("sos.created", '{"phoneId":"p1","id":"s1"}')).toEqual({ type: "sos.created", phoneId: "p1", id: "s1" });
    expect(parseLiveEvent("request.answered", '{"phoneId":"p1","kind":"more-time"}')).toEqual({ type: "request.answered", phoneId: "p1", kind: "more-time" });
    expect(parseLiveEvent("request.answered", '{"phoneId":"p1","kind":"other"}')).toEqual({ type: "request.answered", phoneId: "p1" });
    expect(parseLiveEvent("ping", '{"phoneId":"p1"}')).toBeNull();
    expect(parseLiveEvent("sos.created", "not json")).toBeNull();
    expect(parseLiveEvent("sos.created", "[]")).toBeNull();
    expect(parseLiveEvent("sos.created", '{"id":"s1"}')).toBeNull();
  });

  it("liveMatches checks type and, when given, the phone", () => {
    const e: LiveEvent = { type: "location.updated", phoneId: "p1" };
    expect(liveMatches(e, ["location.updated"], "p1")).toBe(true);
    expect(liveMatches(e, ["location.updated"], undefined)).toBe(true);
    expect(liveMatches(e, ["location.updated"], "p2")).toBe(false);
    expect(liveMatches(e, ["sos.created"], "p1")).toBe(false);
  });

  it("pollInterval slows down only while live", () => {
    expect(pollInterval("live", 30_000)).toBe(5 * 60_000);
    expect(pollInterval("live", 120_000)).toBe(10 * 60_000);
    for (const s of ["off", "connecting", "fallback"] as const) expect(pollInterval(s, 30_000)).toBe(30_000);
  });
});

describe("LiveClient", () => {
  interface Conn {
    url: string;
    h: TransportHandlers;
    closed: boolean;
  }
  let conns: Conn[];
  let events: LiveEvent[];
  let refetches: number;
  let statuses: LiveStatus[];
  let client: LiveClient;

  const last = () => conns[conns.length - 1]!;
  const ready = (resumed = false, c = last()) => {
    c.h.onOpen();
    c.h.onMessage("ready", JSON.stringify({ resumed }), undefined);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
    conns = [];
    events = [];
    refetches = 0;
    statuses = [];
    client = new LiveClient({
      apiBase: "/api",
      random: () => 0.5,
      onStatus: (s) => statuses.push(s),
      onEvent: (e) => events.push(e),
      onRefetch: () => void refetches++,
      transport: (url, h) => {
        const c: Conn = { url, h, closed: false };
        conns.push(c);
        return () => {
          c.closed = true;
        };
      },
    });
  });
  afterEach(() => {
    client.stop();
    vi.useRealTimers();
  });

  it("connects, goes live on ready and passes events on", () => {
    client.start();
    expect(conns.map((c) => c.url)).toEqual(["/api/events"]);
    expect(client.status).toBe("connecting");
    ready();
    expect(client.status).toBe("live");
    last().h.onMessage("sos.created", '{"phoneId":"p1","id":"s1"}', "1");
    last().h.onMessage("ping", "{}", undefined);
    last().h.onMessage("bogus", "{}", undefined);
    expect(events).toEqual([{ type: "sos.created", phoneId: "p1", id: "s1" }]);
    expect(refetches).toBe(0);
  });

  it("start twice opens one connection", () => {
    client.start();
    client.start();
    expect(conns).toHaveLength(1);
  });

  it("refetches on a refetch event", () => {
    client.start();
    ready();
    last().h.onMessage("refetch", "{}", undefined);
    expect(refetches).toBe(1);
    expect(client.status).toBe("live");
  });

  it("reconnects with backoff and resumes from the last id", () => {
    client.start();
    ready();
    last().h.onMessage("location.updated", '{"phoneId":"p1"}', "41");
    last().h.onError();
    expect(client.status).toBe("connecting");
    expect(last().closed).toBe(true);
    vi.advanceTimersByTime(999);
    expect(conns).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(conns).toHaveLength(2);
    expect(last().url).toBe("/api/events?lastEventId=41");
    ready(true);
    expect(refetches).toBe(0);
    expect(client.status).toBe("live");
  });

  it("refetches after a reconnect the server could not resume", () => {
    client.start();
    ready();
    last().h.onError();
    vi.advanceTimersByTime(1_000);
    ready(false);
    expect(refetches).toBe(1);
  });

  it("does not refetch on the very first ready", () => {
    client.start();
    ready(false);
    expect(refetches).toBe(0);
  });

  it("backs off further on repeated failures and starts over after a ready", () => {
    client.start();
    last().h.onError();
    vi.advanceTimersByTime(1_000);
    last().h.onError();
    vi.advanceTimersByTime(1_999);
    expect(conns).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(conns).toHaveLength(3);
    ready();
    last().h.onError();
    vi.advanceTimersByTime(1_000);
    expect(conns).toHaveLength(4);
  });

  it("reconnects after a minute of silence, and pings keep it alive", () => {
    client.start();
    ready();
    vi.advanceTimersByTime(LIVE_SILENCE_MS - 1_000);
    last().h.onMessage("ping", "{}", undefined);
    vi.advanceTimersByTime(LIVE_SILENCE_MS - 1_000);
    expect(conns).toHaveLength(1);
    vi.advanceTimersByTime(2_000);
    expect(conns[0]!.closed).toBe(true);
    expect(client.status).toBe("connecting");
    vi.advanceTimersByTime(1_000);
    expect(conns).toHaveLength(2);
  });

  it("goes to fallback and retries only much later after a refusal", () => {
    client.start();
    last().h.onError(503);
    expect(client.status).toBe("fallback");
    expect(last().closed).toBe(true);
    vi.advanceTimersByTime(LIVE_REFUSED_RETRY_MS - 1);
    expect(conns).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(conns).toHaveLength(2);
    expect(client.status).toBe("fallback");
    ready();
    expect(client.status).toBe("live");
  });

  it("treats 429 the same way", () => {
    client.start();
    last().h.onError(429);
    expect(client.status).toBe("fallback");
  });

  it("stop closes the connection, cancels reconnects and reports off", () => {
    client.start();
    ready();
    client.stop();
    expect(last().closed).toBe(true);
    expect(client.status).toBe("off");
    last().h.onError();
    vi.advanceTimersByTime(10 * 60_000);
    expect(conns).toHaveLength(1);
    expect(statuses.at(-1)).toBe("off");
  });

  it("bye stops the client", () => {
    client.start();
    ready();
    last().h.onMessage("bye", "{}", undefined);
    expect(client.status).toBe("off");
    expect(last().closed).toBe(true);
    vi.advanceTimersByTime(10 * 60_000);
    expect(conns).toHaveLength(1);
  });
});
