// SPDX-License-Identifier: Apache-2.0
//
// The location screen's rules without a screen: what needs polling, the countdown, and the
// status line of a ring and of an "Are you okay?" in every state.
import { makeAppT } from "../src/i18n/I18n";
import { answers, checkinStatus, countdown, needsPolling, ringStatus } from "../src/lib/location";
import { checkin, locationState, ring } from "../test/fakeApi";
import type { LocationState } from "../src/api/models";

const t = makeAppT("en");
const now = Date.now();
const state = (patch: Record<string, unknown>) => locationState(patch) as LocationState;
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

describe("needsPolling", () => {
  it("polls while a ring is active or a question waits", () => {
    expect(needsPolling(state({}))).toBe(false);
    expect(needsPolling(state({ ring: ring() }))).toBe(true);
    expect(needsPolling(state({ ring: ring({ active: false }) }))).toBe(false);
    expect(needsPolling(state({ checkin: checkin() }))).toBe(true);
    expect(needsPolling(state({ checkin: checkin({ status: "answered", answer: "ok" }) }))).toBe(false);
    expect(needsPolling(state({ checkin: checkin({ status: "cancelled" }) }))).toBe(false);
  });

  it("keeps polling for the position of an unanswered question, until it arrives", () => {
    expect(needsPolling(state({ checkin: checkin({ status: "noReply", sendsLocation: true }) }))).toBe(true);
    expect(needsPolling(state({ checkin: checkin({ status: "noReply", sendsLocation: true, locatedAt: iso(0) }) }))).toBe(false);
    // No position will ever follow when the mode does not send one.
    expect(needsPolling(state({ checkin: checkin({ status: "noReply", sendsLocation: false }) }))).toBe(false);
  });
});

describe("countdown", () => {
  it("counts down as m:ss and never goes below zero", () => {
    expect(countdown(300_000)).toBe("5:00");
    expect(countdown(245_000)).toBe("4:05");
    expect(countdown(59_001)).toBe("1:00");
    expect(countdown(0)).toBe("0:00");
    expect(countdown(-5000)).toBe("0:00");
  });
});

describe("answers", () => {
  it("accepts a position recorded at or after the request", () => {
    const loc = { lat: 1, lon: 2, accuracyM: null, recordedAt: "2026-11-17T10:00:00.000Z" };
    expect(answers(loc, "2026-11-17T09:59:59.000Z")).toBe(true);
    expect(answers(loc, "2026-11-17T10:00:00.000Z")).toBe(true);
    expect(answers(loc, "2026-11-17T10:00:01.000Z")).toBe(false);
    expect(answers(null, "2026-11-17T10:00:01.000Z")).toBe(false);
  });
});

describe("ring status", () => {
  const status = (patch: Record<string, unknown>, leftMs = 300_000) => ringStatus(ring(patch, leftMs) as never, Date.now(), t, "en");

  it("has no line without a ring", () => {
    expect(ringStatus(null, now, t, "en")).toBeNull();
  });

  it("waits, then rings, with the time left", () => {
    expect(status({})).toMatchObject({ kind: "waiting", live: true, text: expect.stringMatching(/^Waiting for the phone\. It rings as soon as it gets the message \(\d:\d\d left\)\.$/) });
    expect(status({ shownAt: iso(0) })).toMatchObject({ kind: "ringing", live: true, text: expect.stringMatching(/^The phone is ringing now \(\d:\d\d left\)\.$/) });
  });

  it("keeps the same kind while the countdown ticks, so it is announced once", () => {
    const r = ring({ shownAt: iso(0) }) as never;
    const a = ringStatus(r, now, t, "en")!;
    const b = ringStatus(r, now + 30_000, t, "en")!;
    expect(a.kind).toBe(b.kind);
    expect(a.text).not.toBe(b.text);
  });

  it("says when 'I'm here' was pressed, and whether it still rings", () => {
    expect(status({ active: false, answeredAt: iso(-60_000) })).toMatchObject({ kind: "answered", live: false, text: expect.stringMatching(/^“I'm here” was pressed at /) });
    expect(status({ answeredAt: iso(-60_000), stopOnAnswer: false })).toMatchObject({
      kind: "answeredStillRinging",
      live: true,
      text: expect.stringMatching(/The sound keeps going for \d:\d\d\.$/),
    });
  });

  it("says when it was stopped or nobody answered", () => {
    expect(status({ active: false, stoppedAt: iso(-1000) })).toMatchObject({ kind: "stopped", live: false, text: expect.stringMatching(/^Stopped at /) });
    expect(status({ active: false })).toMatchObject({ kind: "noAnswer", text: "Nobody pressed “I'm here” within 5 minutes." });
  });

  it("is over once the time is up, even if the server has not said so yet", () => {
    expect(status({ active: true }, -1000)).toMatchObject({ kind: "noAnswer", live: false });
  });

  it("speaks Danish", () => {
    const da = ringStatus(ring({ active: false }) as never, now, makeAppT("da"), "da")!;
    expect(da.text).toMatch(/Ingen/);
  });
});

describe("check-in status", () => {
  const status = (patch: Record<string, unknown>) => checkinStatus(checkin(patch) as never, Date.now(), t, "en");

  it("has no line without a question", () => {
    expect(checkinStatus(null, now, t, "en")).toBeNull();
  });

  it("waits for the phone to show it, then for an answer", () => {
    expect(status({})).toMatchObject({ kind: "waiting", live: true, warn: false, text: expect.stringMatching(/^Waiting for the phone to show the question \(\d+:\d\d left\)\.$/) });
    expect(status({ shownAt: iso(0) })).toMatchObject({ kind: "shown", live: true, text: expect.stringMatching(/^The question is on the phone\. Waiting for an answer \(\d+:\d\d left\)\.$/) });
  });

  it("says how it was answered", () => {
    expect(status({ status: "answered", answer: "ok", answeredAt: iso(-1000) })).toMatchObject({
      kind: "answeredOk",
      live: false,
      text: expect.stringMatching(/^“Yes, I'm okay” at .* No position was sent\.$/),
    });
    expect(status({ status: "answered", answer: "call", answeredAt: iso(-1000) })).toMatchObject({
      kind: "answeredCall",
      text: expect.stringMatching(/^“Call me” was pressed at .* The phone is calling you\.$/),
    });
  });

  it("says when it was cancelled", () => {
    expect(status({ status: "cancelled", stoppedAt: iso(-1000) })).toMatchObject({ kind: "cancelled", text: expect.stringMatching(/^Cancelled at /) });
  });

  it("warns when nobody answered, and says whether a position followed", () => {
    expect(status({ status: "noReply", sendsLocation: false })).toMatchObject({ kind: "noReply", warn: true, text: "No answer in time. No position was sent." });
    expect(status({ status: "noReply", sendsLocation: true })).toMatchObject({ kind: "noReplyLocating", warn: true, text: "No answer in time. Waiting for the phone's position…" });
    expect(status({ status: "noReply", sendsLocation: true, locatedAt: iso(-1000) })).toMatchObject({
      kind: "noReplyLocated",
      warn: true,
      text: expect.stringMatching(/^No answer in time\. The phone sent its position at /),
    });
  });
});
