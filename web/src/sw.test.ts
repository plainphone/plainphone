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

const click = (action: string, data: Record<string, unknown> = payload.data) =>
  run("notificationclick", { action, notification: { close: vi.fn(), data: { url: "/phones/p1", ...data } } });

it.each(["15", "60", "day", "no"])("answers %s from the notification with the session cookie, then stays closed", async (action) => {
  load(4);
  await click(action);
  expect(fetchMock).toHaveBeenCalledWith("/api/phones/p1/more-time-requests/r1/answer", expect.objectContaining({
    method: "POST", credentials: "include", body: JSON.stringify({ answer: action }),
  }));
  expect(opened).toEqual([]);
});

it("opens the phone page when the answer fails (not signed in)", async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 401 });
  load(4);
  await click("15");
  expect(opened).toEqual(["https://pp.example/phones/p1"]);
});

it("opens the phone page when the network is down", async () => {
  fetchMock.mockRejectedValue(new TypeError("offline"));
  load(4);
  await click("no");
  expect(opened).toEqual(["https://pp.example/phones/p1"]);
});

it("opens the url on a click without an action, and ignores unknown actions", async () => {
  load(4);
  await click("");
  await click("bogus");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(opened).toEqual(["https://pp.example/phones/p1", "https://pp.example/phones/p1"]);
});
