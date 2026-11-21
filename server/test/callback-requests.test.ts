// SPDX-License-Identifier: Apache-2.0
// "Ask a parent to call" (docs/sos.md#asking-a-parent-to-call). The harness clock is fixed.
// Every number here is synthetic.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { callbackRequests, pushSubscriptions } from "../src/db/schema.js";
import { CALLBACK_TTL_MS } from "../src/services/callback-requests.js";
import { sweep } from "../src/services/sweeper.js";
import { pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();
const NUMBER = "+4500000001";
const OTHER_NUMBER = "+4500000002";
const HOUR = 3_600_000;

async function setup(email = "parent@example.org", profile: "child" | "self" = "child") {
  const parent = await signIn(h, email);
  const paired = await pairPhone(h, parent, { profile, name: "Sam" });
  const { user } = (await parent.get("/api/me")).json;
  return { parent, ...paired, userId: user.id as string };
}

async function subscribe(userId: string) {
  await h.ctx.db.insert(pushSubscriptions).values({ userId, platform: "web", endpoint: `https://example.test/${userId}` });
}

type S = Awaited<ReturnType<typeof setup>>;
const sos = (s: S) => `/api/phones/${s.phoneId}/sos`;
const list = (s: S) => `/api/phones/${s.phoneId}/callback-requests`;
/** A phone with a confirmed number and the switch on. */
async function enabled(s?: S) {
  const ready = s ?? await setup();
  expect((await ready.parent.put(sos(ready), { callbackNumber: NUMBER, callbackConfirmed: true, callbackRequests: true })).status).toBe(204);
  return ready;
}
const ask = (s: S, body: Record<string, unknown> = {}) => s.device.post("/api/device/callback-requests", { id: randomUUID(), ...body });
const rulesCallback = async (s: S) => (await s.device.get("/api/device/rules")).json.sos.callback;

describe("the switch and the number", () => {
  it("is off for a new phone and the rules say so", async () => {
    const s = await setup();
    expect((await s.parent.get(sos(s))).json.settings).toMatchObject({ callbackRequests: false, callbackConfirmed: false });
    expect(await rulesCallback(s)).toEqual({ enabled: false });
  });

  it("cannot be turned on without a confirmed number", async () => {
    const s = await setup();
    expect((await s.parent.put(sos(s), { callbackRequests: true })).status).toBe(409);
    // A number alone is not confirmed.
    expect((await s.parent.put(sos(s), { callbackNumber: NUMBER, callbackRequests: true })).status).toBe(409);
    expect((await s.parent.put(sos(s), { callbackNumber: NUMBER })).status).toBe(204);
    expect((await s.parent.put(sos(s), { callbackRequests: true })).status).toBe(409);
    expect((await s.parent.get(sos(s))).json.settings).toMatchObject({ callbackRequests: false, callbackConfirmed: false });
    expect((await s.parent.put(sos(s), { callbackConfirmed: true, callbackRequests: true })).status).toBe(204);
    expect((await s.parent.get(sos(s))).json.settings).toMatchObject({ callbackRequests: true, callbackConfirmed: true });
    expect(await rulesCallback(s)).toEqual({ enabled: true });
  });

  it("never puts the number in the rules", async () => {
    const s = await enabled();
    expect(JSON.stringify((await s.device.get("/api/device/rules")).json)).not.toContain(NUMBER.slice(1));
  });

  it("goes off on the phone when the number is cleared, and stays off when it comes back unconfirmed", async () => {
    const s = await enabled();
    expect((await s.parent.put(sos(s), { callbackNumber: null })).status).toBe(204);
    expect((await s.parent.get(sos(s))).json).toMatchObject({ callbackNumber: null, settings: { callbackRequests: false } });
    expect(await rulesCallback(s)).toEqual({ enabled: false });
    await s.parent.put(sos(s), { callbackNumber: NUMBER });
    expect(await rulesCallback(s)).toEqual({ enabled: false });
    await s.parent.put(sos(s), { callbackConfirmed: true });
    // Confirming is not turning it on again.
    expect(await rulesCallback(s)).toEqual({ enabled: false });
  });

  it("goes off when the number changes without confirmation, and stays on with confirmation", async () => {
    const s = await enabled();
    await s.parent.put(sos(s), { callbackNumber: OTHER_NUMBER, callbackConfirmed: true });
    expect(await rulesCallback(s)).toEqual({ enabled: true });
    await s.parent.put(sos(s), { callbackNumber: NUMBER });
    expect(await rulesCallback(s)).toEqual({ enabled: false });
  });

  it("can be turned off with the number kept", async () => {
    const s = await enabled();
    await s.parent.put(sos(s), { callbackRequests: false });
    expect(await rulesCallback(s)).toEqual({ enabled: false });
    expect((await s.parent.get(sos(s))).json).toMatchObject({ callbackNumber: NUMBER, settings: { callbackConfirmed: true } });
  });

  it("does not exist on a Myself phone", async () => {
    const s = await setup("adult@example.org", "self");
    expect((await s.parent.get(list(s))).status).toBe(404);
    expect((await ask(s)).status).toBe(404);
  });
});

describe("a request", () => {
  it("is refused while the switch is off", async () => {
    const s = await setup();
    expect((await ask(s)).status).toBe(403);
    await enabled(s);
    await s.parent.put(sos(s), { callbackRequests: false });
    expect((await ask(s)).status).toBe(403);
    expect((await s.parent.get(list(s))).json.requests).toEqual([]);
  });

  it("pushes once without a number, and a retry or a second tap joins it", async () => {
    const s = await enabled();
    await subscribe(s.userId);
    const id = randomUUID();
    const first = await s.device.post("/api/device/callback-requests", { id });
    expect(first.json).toMatchObject({ id, state: "sent" });
    expect(await s.device.post("/api/device/callback-requests", { id })).toMatchObject({ json: { id, state: "sent" } });
    // Another tap with a new id while the first is open does not alert again.
    const second = await ask(s);
    expect(second.json.id).toBe(id);
    expect(h.parentPush.sent).toHaveLength(1);
    const message = JSON.stringify(h.parentPush.sent[0]);
    expect(message).not.toContain(NUMBER.slice(1));
    expect(message).toContain("callback-request");
    expect((await s.parent.get(list(s))).json.requests).toHaveLength(1);
  });

  it("is queued until a parent device is reachable, then sent by the sweeper", async () => {
    const s = await enabled();
    const id = randomUUID();
    expect((await s.device.post("/api/device/callback-requests", { id })).json.state).toBe("queued");
    // It waits in the dashboard meanwhile.
    expect((await s.parent.get(list(s))).json).toMatchObject({ callbackNumber: NUMBER, requests: [{ id, state: "queued", number: "ok" }] });
    await subscribe(s.userId);
    await sweep(h.ctx);
    expect((await s.device.get(`/api/device/callback-requests/${id}`)).json.state).toBe("sent");
    expect(h.parentPush.sent).toHaveLength(1);
    await sweep(h.ctx);
    expect(h.parentPush.sent).toHaveLength(1);
  });

  it("expires after 24 hours and is deleted a day later", async () => {
    const s = await enabled();
    const id = randomUUID();
    await s.device.post("/api/device/callback-requests", { id });
    h.clock.advance(CALLBACK_TTL_MS - 1000);
    expect((await s.device.get(`/api/device/callback-requests/${id}`)).json.state).toBe("queued");
    h.clock.advance(2000);
    expect((await s.device.get(`/api/device/callback-requests/${id}`)).json.state).toBe("expired");
    expect((await s.parent.get(list(s))).json.requests[0]).toMatchObject({ state: "expired" });
    // An expired request is not open: the next tap makes a new one.
    expect((await ask(s)).json.state).toBe("queued");
    h.clock.advance(49 * HOUR);
    await sweep(h.ctx);
    expect(await h.ctx.db.select().from(callbackRequests).where(eq(callbackRequests.phoneId, s.phoneId))).toHaveLength(0);
  });

  it("recorded late after the phone was offline: old ones are stored as expired without an alert", async () => {
    const s = await enabled();
    await subscribe(s.userId);
    const old = await ask(s, { sentAt: new Date(h.clock.now.getTime() - 25 * HOUR).toISOString() });
    expect(old.json.state).toBe("expired");
    expect(h.parentPush.sent).toHaveLength(0);
    // A request made an hour ago still alerts: it has 23 hours left.
    const recent = await ask(s, { sentAt: new Date(h.clock.now.getTime() - HOUR).toISOString() });
    expect(recent.json.state).toBe("sent");
    expect(h.parentPush.sent).toHaveLength(1);
    expect(new Date(recent.json.expiresAt).getTime()).toBe(h.clock.now.getTime() + 23 * HOUR);
  });

  it("is still recorded and notified when the phone reports it after the switch went off", async () => {
    const s = await enabled();
    await subscribe(s.userId);
    const sentAt = new Date(h.clock.now.getTime() - 60_000).toISOString();
    await s.parent.put(sos(s), { callbackRequests: false });
    expect((await ask(s)).status).toBe(403);
    const late = await ask(s, { sentAt });
    expect(late.status).toBe(200);
    expect(late.json.state).toBe("sent");
    expect(h.parentPush.sent).toHaveLength(1);
  });

  it("is stored but not notified when a parent muted the phone", async () => {
    const s = await enabled();
    await subscribe(s.userId);
    expect((await s.parent.put(`/api/phones/${s.phoneId}/notifications`, { enabled: false })).status).toBe(204);
    expect((await ask(s)).json.state).toBe("queued");
    expect(h.parentPush.sent).toHaveLength(0);
  });
});

describe("who can see and answer it", () => {
  it("is private to the household and to the phone", async () => {
    const s = await enabled();
    const id = (await ask(s)).json.id as string;
    const stranger = await setup("stranger@example.org");
    await enabled(stranger);
    // Another household's parent sees nothing and cannot answer.
    const other = stranger.parent;
    expect((await other.get(list(s))).status).toBe(404);
    expect((await other.post(`${list(s)}/${id}/done`, { via: "other" })).status).toBe(404);
    // Another phone cannot read this phone's request.
    expect((await stranger.device.get(`/api/device/callback-requests/${id}`)).status).toBe(404);
    // And the other household's own list does not contain it.
    expect((await other.get(list(stranger))).json.requests).toEqual([]);
    expect((await s.device.get("/api/device/callback-requests/" + id)).status).toBe(200);
  });

  it("needs a sign-in", async () => {
    const s = await enabled();
    const anonymous = await signInless();
    expect((await anonymous.get(list(s))).status).toBe(401);
    expect((await anonymous.post("/api/device/callback-requests", { id: randomUUID() })).status).toBe(401);
  });
});

async function signInless() {
  const { Client } = await import("./harness.js");
  return new Client(h);
}

describe("calling back", () => {
  it("accepts the number the screen showed, once, and tells the phone", async () => {
    const s = await enabled();
    const id = (await ask(s)).json.id as string;
    const done = await s.parent.post(`${list(s)}/${id}/done`, { via: "number", number: NUMBER });
    expect(done.json).toMatchObject({ id, state: "done", doneVia: "number", number: "ok" });
    // A second tap changes nothing; the first answer stands.
    const again = await s.parent.post(`${list(s)}/${id}/done`, { via: "other" });
    expect(again.json).toMatchObject({ state: "done", doneVia: "number" });
    expect((await s.device.get(`/api/device/callback-requests/${id}`)).json.state).toBe("done");
    // Answered, so the next tap is a new request.
    expect((await ask(s)).json.id).not.toBe(id);
  });

  it("refuses a number that changed after the request, even when the screen still shows the old one", async () => {
    const s = await enabled();
    const id = (await ask(s)).json.id as string;
    h.clock.advance(60_000);
    await s.parent.put(sos(s), { callbackNumber: OTHER_NUMBER, callbackConfirmed: true });
    expect((await s.parent.get(list(s))).json).toMatchObject({ callbackNumber: OTHER_NUMBER, requests: [{ id, number: "changed" }] });
    const stale = await s.parent.post(`${list(s)}/${id}/done`, { via: "number", number: NUMBER });
    expect(stale.status).toBe(409);
    expect(stale.json.error ?? stale.json.message ?? JSON.stringify(stale.json)).toContain("changed");
    // The new number is not dialled for an old request either.
    expect((await s.parent.post(`${list(s)}/${id}/done`, { via: "number", number: OTHER_NUMBER })).status).toBe(409);
    expect((await s.parent.get(list(s))).json.requests[0].state).not.toBe("done");
  });

  it("refuses when the number was cleared, and still allows calling from the parent's own contacts", async () => {
    const s = await enabled();
    const id = (await ask(s)).json.id as string;
    await s.parent.put(sos(s), { callbackNumber: null });
    expect((await s.parent.get(list(s))).json).toMatchObject({ callbackNumber: null, requests: [{ number: "missing" }] });
    expect((await s.parent.post(`${list(s)}/${id}/done`, { via: "number", number: NUMBER })).status).toBe(409);
    const other = await s.parent.post(`${list(s)}/${id}/done`, { via: "other" });
    expect(other.json).toMatchObject({ state: "done", doneVia: "other" });
  });

  it("does not dial an expired request, but records a report queued on a device before it expired", async () => {
    const s = await enabled();
    const id = (await ask(s)).json.id as string;
    const happened = new Date(h.clock.now.getTime() + 2 * HOUR).toISOString();
    h.clock.advance(CALLBACK_TTL_MS + 1000);
    expect((await s.parent.post(`${list(s)}/${id}/done`, { via: "number", number: NUMBER })).status).toBe(409);
    expect((await s.parent.post(`${list(s)}/${id}/done`, { via: "other" })).status).toBe(409);
    const late = await s.parent.post(`${list(s)}/${id}/done`, { via: "other", at: happened });
    expect(late.json).toMatchObject({ state: "done", doneAt: happened });
    // Recording it alerts nobody.
    expect(h.parentPush.sent).toHaveLength(0);
  });

  it("answers 404 for an unknown request", async () => {
    const s = await enabled();
    expect((await s.parent.post(`${list(s)}/${randomUUID()}/done`, { via: "other" })).status).toBe(404);
  });
});
