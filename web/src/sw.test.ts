// SPDX-License-Identifier: Apache-2.0
//
// public/sw.js is a plain script, so it is run here against a fake worker scope.
import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";

type Handler = (event: Record<string, unknown>) => void;

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

let handlers: Record<string, Handler>;
let shown: { title: string; options: Record<string, unknown> }[];
let opened: string[];
let fetchMock: ReturnType<typeof vi.fn>;

function load(maxActions: number | undefined) {
  handlers = {};
  shown = [];
  opened = [];
  const self = {
    location: { origin: "https://pp.example" },
    addEventListener: (name: string, fn: Handler) => { handlers[name] = fn; },
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => { shown.push({ title, options }); } },
    clients: {
      matchAll: async () => [],
      openWindow: async (u: string) => { opened.push(u); },
    },
  };
  new Function("self", "Notification", "fetch", "caches", source)(self, { maxActions }, fetchMock, {});
}

async function run(name: string, event: Record<string, unknown>) {
  const waits: Promise<unknown>[] = [];
  handlers[name]!({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
}

const payload = {
  title: "Alma asks for more time", body: "Video", url: "/phones/p1", tag: "more-time-r1",
  actions: [{ id: "15", title: "15 min" }, { id: "60", title: "1 hour" }, { id: "day", title: "Rest of the day" }, { id: "no", title: "No" }],
  data: { type: "more-time", phoneId: "p1", requestId: "r1" },
};
const push = (p: unknown) => run("push", { data: { json: () => p } });

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
});

it("passes the actions the browser can show, and the request ids, to the notification", async () => {
  load(3);
  await push(payload);
  expect(shown[0]!.options.actions).toEqual([
    { action: "15", title: "15 min" }, { action: "60", title: "1 hour" }, { action: "no", title: "No" },
  ]);
  expect(shown[0]!.options.data).toMatchObject({ url: "/phones/p1", type: "more-time", phoneId: "p1", requestId: "r1" });
});

it("keeps a quick yes and a quick no when the browser shows only two buttons", async () => {
  load(2);
  await push(payload);
  expect(shown[0]!.options.actions).toEqual([{ action: "15", title: "15 min" }, { action: "no", title: "No" }]);
});

it("shows no actions on a plain message", async () => {
  load(4);
  await push({ title: "Hello", url: "/" });
  expect("actions" in shown[0]!.options).toBe(false);
});

const words = {
  done: { "15": "15 more minutes given", "60": "60 more minutes given", day: "Given the rest of the day", no: "Declined" },
  wait: "The phone will confirm when it is active.",
  other: "Already answered by another parent",
  expired: "This request had expired",
  failed: "Could not answer, open Plainphone",
};
const withWords = { ...payload.data, phoneName: "Alma", words };
const click = (action: string, data: Record<string, unknown> = withWords) =>
  run("notificationclick", { action, notification: { close: vi.fn(), tag: "more-time-r1", data: { url: "/phones/p1", ...data } } });
const decided = (over: Record<string, unknown>) => ({
  ok: true, status: 200,
  json: async () => ({ id: "r1", status: "approved", answer: "15", won: true, answeredByYou: true, ...over }),
});

it.each(["15", "60", "day", "no"])("answers %s from the notification with the session cookie, then stays closed", async (action) => {
  load(4);
  await click(action);
  expect(fetchMock).toHaveBeenCalledWith("/api/phones/p1/more-time-requests/r1/answer", expect.objectContaining({
    method: "POST", credentials: "include", body: JSON.stringify({ answer: action, source: "notification" }),
  }));
  expect(opened).toEqual([]);
});

it("carries the phone name and the follow-up lines from the push to the click", async () => {
  load(4);
  await push({ ...payload, data: withWords });
  expect(shown[0]!.options.data).toMatchObject({ phoneName: "Alma", words });
});

it("follows up quietly under the same tag: what was answered, and that the phone will confirm", async () => {
  fetchMock.mockResolvedValue(decided({}));
  load(4);
  await click("15");
  expect(shown).toHaveLength(1);
  expect(shown[0]!.title).toBe("Alma");
  expect(shown[0]!.options).toMatchObject({
    body: "15 more minutes given. The phone will confirm when it is active.",
    tag: "more-time-r1", silent: true,
    data: { url: "/phones/p1", type: "more-time-done" },
  });
  // The follow-up has no buttons and is not "more-time", so a tap on it cannot answer again.
  expect("actions" in shown[0]!.options).toBe(false);
  expect(opened).toEqual([]);
});

it("does not promise a confirmation for a decline, or when the server sent none (receipts off)", async () => {
  load(4);
  fetchMock.mockResolvedValue(decided({ status: "declined", answer: "no" }));
  await click("no");
  expect(shown[0]!.options.body).toBe("Declined");
  fetchMock.mockResolvedValue(decided({ answer: "60" }));
  await click("60", { ...withWords, words: { ...words, wait: undefined } });
  expect(shown[1]!.options.body).toBe("60 more minutes given");
});

it("treats a double tap as a success, not an error", async () => {
  fetchMock.mockResolvedValue(decided({ won: false, answeredByYou: true }));
  load(4);
  await click("15");
  expect(shown[0]!.options.body).toBe("15 more minutes given. The phone will confirm when it is active.");
});

it("shows the other parent's answer when they were first, not an error", async () => {
  fetchMock.mockResolvedValue(decided({ won: false, answeredByYou: false, answer: "60" }));
  load(4);
  await click("15");
  expect(shown[0]!.options).toMatchObject({ body: "Already answered by another parent: 60 more minutes given", silent: true, tag: "more-time-r1" });
  expect(opened).toEqual([]);
});

it("says so in plain words when the request had expired, and a tap opens the dashboard", async () => {
  fetchMock.mockResolvedValue(decided({ status: "expired", answer: null, won: false, answeredByYou: false }));
  load(4);
  await click("15");
  expect(shown[0]!.options).toMatchObject({ body: "This request had expired", data: { url: "/phones/p1", type: "more-time-failed" } });
  expect(shown[0]!.options.silent).toBeUndefined();
  expect(opened).toEqual([]);
});

it("says it could not answer when the session is gone, and keeps the request one tap away", async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 401 });
  load(4);
  await click("15");
  expect(shown[0]!.options).toMatchObject({ body: "Could not answer, open Plainphone", tag: "more-time-r1", renotify: true, data: { url: "/phones/p1" } });
  expect(opened).toEqual([]);
  // A tap on that notification opens the request.
  await run("notificationclick", { action: "", notification: { close: vi.fn(), data: shown[0]!.options.data } });
  expect(opened).toEqual(["https://pp.example/phones/p1"]);
});

it("says it could not answer when the network is down", async () => {
  fetchMock.mockRejectedValue(new TypeError("offline"));
  load(4);
  await click("no");
  expect(shown[0]!.options.body).toBe("Could not answer, open Plainphone");
});

it("opens the phone page when the push carried no lines (an older server)", async () => {
  fetchMock.mockRejectedValue(new TypeError("offline"));
  load(4);
  await click("15", payload.data);
  expect(shown).toEqual([]);
  expect(opened).toEqual(["https://pp.example/phones/p1"]);
});

it("stays quiet and closed when an older push carried no lines but the answer went through", async () => {
  fetchMock.mockResolvedValue(decided({}));
  load(4);
  await click("15", payload.data);
  expect(shown).toEqual([]);
  expect(opened).toEqual([]);
});

it("shows the receipt from the phone as a silent update of the same notification", async () => {
  load(4);
  await push({
    title: "Alma", body: "15 more minutes given. Active on the phone at 14:05", url: "/phones/p1", tag: "more-time-r1", silent: true,
    data: { type: "more-time-receipt", phoneId: "p1", requestId: "r1" },
  });
  expect(shown[0]!.options).toMatchObject({ body: "15 more minutes given. Active on the phone at 14:05", tag: "more-time-r1", silent: true, renotify: false });
  expect("actions" in shown[0]!.options).toBe(false);
});

it("opens the url on a click without an action, and ignores unknown actions", async () => {
  load(4);
  await click("");
  await click("bogus");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(opened).toEqual(["https://pp.example/phones/p1", "https://pp.example/phones/p1"]);
});

it("confirms arrival and opening with the receipt id, without the session cookie", async () => {
  load(4);
  const receipt = "r".repeat(22);
  await push({ title: "Alma needs help", url: "/phones/p1", tag: "sos1", receipt, data: { type: "sos-urgent", phoneId: "p1" } });
  expect(shown).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledWith("/api/push-receipt", expect.objectContaining({
    method: "POST", credentials: "omit", body: JSON.stringify({ receipt, event: "delivered" }),
  }));
  await click("", shown[0]!.options.data as Record<string, unknown>);
  expect(fetchMock).toHaveBeenLastCalledWith("/api/push-receipt", expect.objectContaining({ body: JSON.stringify({ receipt, event: "opened" }) }));
});

it("still shows the alert when the receipt cannot be sent, and sends none for a malformed id", async () => {
  load(4);
  fetchMock.mockRejectedValue(new TypeError("offline"));
  await push({ title: "Alma needs help", url: "/", receipt: "r".repeat(22) });
  expect(shown).toHaveLength(1);
  fetchMock.mockClear();
  await push({ title: "Hello", url: "/", receipt: "../../x" });
  expect(fetchMock).not.toHaveBeenCalled();
});
