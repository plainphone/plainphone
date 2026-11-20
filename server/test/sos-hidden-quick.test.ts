// SPDX-License-Identifier: Apache-2.0
// Hidden SOS and quick messages (docs/sos.md). The harness clock is fixed.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { pushSubscriptions, quickMessageSends } from "../src/db/schema.js";
import { sweep } from "../src/services/sweeper.js";
import { pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

async function setup(profile: "child" | "self" = "child", quick = false) {
  const parent = await signIn(h, "parent@example.org");
  const paired = await pairPhone(h, parent, { profile });
  const { user } = (await parent.get("/api/me")).json;
  // Quick messages are off for a new phone since the family inbox (#119).
  if (quick) await parent.put(`/api/phones/${paired.phoneId}/sos`, { quickMessagesEnabled: true });
  return { parent, ...paired, userId: user.id as string };
}

async function subscribe(userId: string) {
  await h.ctx.db.insert(pushSubscriptions).values({ userId, platform: "web", endpoint: "https://example.test/parent" });
}

describe("hidden SOS settings", () => {
  it("are off by default, toggle one at a time and reach the phone's rules", async () => {
    const { parent, phoneId, device } = await setup();
    const path = `/api/phones/${phoneId}/sos`;
    expect((await parent.get(path)).json.settings).toEqual({
      hiddenPower: false, hiddenPresses: 4, hiddenClock: false, hiddenFeedback: "vibrate",
      quickMessagesEnabled: false, quickSuggestionsEnabled: true, familyInbox: false, checkIns: false,
      extendedFamily: false, locationSnapshots: false,
    });
    expect((await device.get("/api/device/rules")).json.sos).toMatchObject({
      hidden: { power: false, presses: 4, clock: false, feedback: "vibrate" },
      quickMessages: { enabled: false, suggest: false, items: [] },
    });
    expect((await parent.put(path, { hiddenPower: true, hiddenPresses: 5 })).status).toBe(204);
    expect((await parent.put(path, { hiddenClock: true, hiddenFeedback: "none" })).status).toBe(204);
    expect((await device.get("/api/device/rules")).json.sos.hidden).toEqual({ power: true, presses: 5, clock: true, feedback: "none" });
    // The callback number still saves on its own and keeps the switches.
    expect((await parent.put(path, { callbackNumber: "+4512345678" })).status).toBe(204);
    expect((await parent.get(path)).json).toMatchObject({ callbackNumber: "+4512345678", settings: { hiddenPower: true } });
    expect((await parent.put(path, { hiddenPresses: 9 })).status).toBe(400);
    expect((await parent.put(path, { hiddenFeedback: "loud" })).status).toBe(400);
  });

  it("has no hidden SOS or quick messages on a Myself phone", async () => {
    const { parent, phoneId, device } = await setup("self");
    expect((await parent.put(`/api/phones/${phoneId}/sos`, { hiddenPower: true })).status).toBe(404);
    expect((await device.get("/api/device/rules")).json.sos).toBeUndefined();
    expect((await parent.get(`/api/phones/${phoneId}/quick-messages`)).status).toBe(404);
  });
});

describe("hidden and code-word SOS reports", () => {
  it("records how it was sent and tells the parents with the code word", async () => {
    const { parent, phoneId, device, userId } = await setup();
    await subscribe(userId);
    const power = { id: randomUUID(), kind: "urgent", trigger: "power", location: { lat: 55.6, lon: 12.5 } };
    expect((await device.post("/api/device/sos", power)).json).toMatchObject({ trigger: "power", message: null });
    const code = { id: randomUUID(), kind: "urgent", trigger: "code", message: "Pick me up" };
    expect((await device.post("/api/device/sos", code)).json).toMatchObject({ trigger: "code", message: "Pick me up" });
    await vi.waitFor(() => expect(h.parentPush.sent).toHaveLength(2));
    const bodies = h.parentPush.sent.map((s) => s.msg.body).sort();
    expect(bodies).toEqual(['I need help now. Code word: "Pick me up"', "I need help now. Sent quietly with the power button."]);
    expect(h.parentPush.sent.every((s) => s.urgent)).toBe(true);
    const events = (await parent.get(`/api/phones/${phoneId}/sos`)).json.events;
    expect(events.map((e: { trigger: string }) => e.trigger).sort()).toEqual(["code", "power"]);
  });

  it("accepts a hidden SOS even after the parents switched it off: the phone already sent it", async () => {
    const { parent, phoneId, device } = await setup();
    await parent.put(`/api/phones/${phoneId}/sos`, { hiddenClock: false });
    const report = { id: randomUUID(), kind: "urgent", trigger: "clock" };
    expect((await device.post("/api/device/sos", report)).status).toBe(200);
  });

  it("rejects a hidden help report and a code word without its text", async () => {
    const { device } = await setup();
    expect((await device.post("/api/device/sos", { id: randomUUID(), kind: "help", trigger: "power" })).status).toBe(400);
    expect((await device.post("/api/device/sos", { id: randomUUID(), kind: "urgent", trigger: "code" })).status).toBe(400);
    expect((await device.post("/api/device/sos", { id: randomUUID(), kind: "urgent", message: "hi" })).status).toBe(400);
  });
});

describe("quick messages", () => {
  it("are written by the parents, limited to six and sent to the phone with the code-word flag", async () => {
    const { parent, phoneId, device } = await setup("child", true);
    const path = `/api/phones/${phoneId}/quick-messages`;
    const first = await parent.post(path, { text: "  Pick me up " });
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({ text: "Pick me up", meansSos: false });
    const code = (await parent.post(path, { text: "Call me", meansSos: true })).json;
    for (const text of ["I'm okay", "Running late", "At school", "Home soon"]) {
      expect((await parent.post(path, { text })).status).toBe(201);
    }
    expect((await parent.post(path, { text: "Seventh" })).status).toBe(409);
    expect((await parent.post(path, { text: "x".repeat(61) })).status).toBe(400);
    const items = (await device.get("/api/device/rules")).json.sos.quickMessages.items;
    expect(items).toHaveLength(6);
    expect(items[1]).toEqual({ id: code.id, text: "Call me", meansSos: true });
    expect((await parent.patch(`${path}/${first.json.id}`, { meansSos: true })).json.meansSos).toBe(true);
    expect((await parent.patch(`${path}/${first.json.id}`, {})).status).toBe(400);
    expect((await parent.del(`${path}/${code.id}`)).status).toBe(204);
    expect((await parent.get(path)).json.messages).toHaveLength(5);
    // Switched off, the phone gets no messages and cannot suggest.
    await parent.put(`/api/phones/${phoneId}/sos`, { quickMessagesEnabled: false });
    expect((await device.get("/api/device/rules")).json.sos.quickMessages).toEqual({ enabled: false, suggest: false, items: [] });
  });

  it("notifies the parents once per id and tells the phone when nobody got a push", async () => {
    const { phoneId, device, userId } = await setup("child", true);
    const id = randomUUID();
    // No push registration yet: the phone falls back to SMS.
    expect((await device.post("/api/device/quick-messages/send", { id, text: "I'm okay" })).json).toEqual({ notified: 0 });
    await subscribe(userId);
    const second = randomUUID();
    expect((await device.post("/api/device/quick-messages/send", { id: second, text: "I'm okay" })).json).toEqual({ notified: 1 });
    expect((await device.post("/api/device/quick-messages/send", { id: second, text: "I'm okay" })).json).toEqual({ notified: 1 });
    expect(h.parentPush.sent).toHaveLength(1);
    expect(h.parentPush.sent[0]!.msg.title).toMatch(/: "I'm okay"$/);
    expect(h.parentPush.sent[0]!.urgent).toBe(false);
    // Kept for a day, only to recognise a retry.
    h.clock.advance(86_400_000 + 1);
    await sweep(h.ctx);
    expect(await h.ctx.db.select().from(quickMessageSends).where(eq(quickMessageSends.phoneId, phoneId))).toEqual([]);
  });

  it("goes quiet over the limit without refusing the phone", async () => {
    const { device, userId } = await setup("child", true);
    await subscribe(userId);
    for (let i = 0; i < 10; i++) {
      expect((await device.post("/api/device/quick-messages/send", { id: randomUUID(), text: "Hi" })).json.notified).toBe(1);
    }
    // Over the limit the answer says so, so the phone does not send an SMS instead.
    const over = randomUUID();
    expect((await device.post("/api/device/quick-messages/send", { id: over, text: "Hi" })).json).toEqual({ notified: 0, limited: true });
    expect((await device.post("/api/device/quick-messages/send", { id: over, text: "Hi" })).json).toEqual({ notified: 0, limited: true });
    expect(h.parentPush.sent).toHaveLength(10);
  });

  it("answers a repeat during the first send with pending, and gives up on a stale one", async () => {
    const { phoneId, device } = await setup("child", true);
    const id = randomUUID();
    await h.ctx.db.insert(quickMessageSends).values({ phoneId, id, createdAt: h.ctx.now(), notified: -2 });
    expect((await device.post("/api/device/quick-messages/send", { id, text: "Hi" })).json).toEqual({ notified: 0, pending: true });
    h.clock.advance(61_000);
    expect((await device.post("/api/device/quick-messages/send", { id, text: "Hi" })).json).toEqual({ notified: 0 });
  });

  it("lets the child suggest one and a parent approve or decline it", async () => {
    const { parent, phoneId, device, userId } = await setup("child", true);
    await subscribe(userId);
    const path = `/api/phones/${phoneId}/quick-messages`;
    const suggested = await device.post("/api/device/quick-messages/suggest", { text: "Can I stay longer?" });
    expect(suggested.status).toBe(201);
    expect(h.parentPush.sent.at(-1)!.msg.body).toBe('"Can I stay longer?". Open the app to approve or decline.');
    // The same text again does not add a second suggestion or notify again.
    expect((await device.post("/api/device/quick-messages/suggest", { text: "can i stay longer?" })).json.id).toBe(suggested.json.id);
    expect(h.parentPush.sent).toHaveLength(1);
    await device.post("/api/device/quick-messages/suggest", { text: "Two" });
    await device.post("/api/device/quick-messages/suggest", { text: "Three" });
    expect((await device.post("/api/device/quick-messages/suggest", { text: "Four" })).status).toBe(409);
    const list = (await parent.get(path)).json;
    expect(list.messages).toEqual([]);
    expect(list.suggestions.map((s: { text: string }) => s.text)).toEqual(["Can I stay longer?", "Two", "Three"]);
    // Suggestions are not on the phone until approved.
    expect((await device.get("/api/device/rules")).json.sos.quickMessages.items).toEqual([]);
    expect((await parent.post(`${path}/${suggested.json.id}/approve`, { meansSos: true })).json).toMatchObject({ meansSos: true });
    expect((await device.get("/api/device/rules")).json.sos.quickMessages.items).toEqual([
      { id: suggested.json.id, text: "Can I stay longer?", meansSos: true },
    ]);
    const two = list.suggestions[1].id;
    expect((await parent.post(`${path}/${two}/decline`)).status).toBe(204);
    expect((await parent.post(`${path}/${two}/decline`)).status).toBe(404);
    expect((await parent.get(path)).json.suggestions.map((s: { text: string }) => s.text)).toEqual(["Three"]);
    await parent.put(`/api/phones/${phoneId}/sos`, { quickSuggestionsEnabled: false });
    expect((await device.get("/api/device/rules")).json.sos.quickMessages.suggest).toBe(false);
    expect((await device.post("/api/device/quick-messages/suggest", { text: "Five" })).status).toBe(403);
  });

  it("does not approve a suggestion past six messages", async () => {
    const { parent, phoneId, device } = await setup("child", true);
    const path = `/api/phones/${phoneId}/quick-messages`;
    const { id } = (await device.post("/api/device/quick-messages/suggest", { text: "Later" })).json;
    for (let i = 0; i < 6; i++) await parent.post(path, { text: `Message ${i}` });
    expect((await parent.post(`${path}/${id}/approve`)).status).toBe(409);
  });
});
