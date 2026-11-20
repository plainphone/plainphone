// SPDX-License-Identifier: Apache-2.0
// The family inbox (docs/family-inbox.md). The harness clock is fixed.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { contacts, familyMessages, pushSubscriptions } from "../src/db/schema.js";
import { sweep } from "../src/services/sweeper.js";
import { pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

async function setup(email = "parent@example.org", profile: "child" | "self" = "child") {
  const parent = await signIn(h, email);
  const paired = await pairPhone(h, parent, { profile, name: "Sam" });
  const { user } = (await parent.get("/api/me")).json;
  return { parent, ...paired, userId: user.id as string };
}

async function subscribe(userId: string) {
  await h.ctx.db.insert(pushSubscriptions).values({ userId, platform: "web", endpoint: `https://example.test/${userId}` });
}

const switches = (phoneId: string) => `/api/phones/${phoneId}/sos`;
const send = (body: Record<string, unknown>) => ({ id: randomUUID(), text: "Pick me up", inbox: true, ...body });

describe("family inbox switches", () => {
  it("are all off for a new phone, keep the inbox out of the rules and switch independently", async () => {
    const { parent, phoneId, device } = await setup();
    expect((await parent.get(switches(phoneId))).json.settings).toMatchObject({
      familyInbox: false, quickMessagesEnabled: false, checkIns: false,
    });
    expect((await device.get("/api/device/rules")).json.inbox).toBeUndefined();
    expect((await device.get("/api/device/inbox")).json).toEqual({
      familyInbox: false, quickMessages: false, checkIns: false, recipients: [], messages: [],
    });

    // Check-ins and quick messages alone do nothing for the inbox while it is off.
    await parent.put(switches(phoneId), { checkIns: true, quickMessagesEnabled: true });
    expect((await device.get("/api/device/rules")).json.inbox).toBeUndefined();

    await parent.put(switches(phoneId), { familyInbox: true });
    expect((await device.get("/api/device/rules")).json.inbox).toEqual({ enabled: true, quickMessages: true, checkIns: true, latest: null });
    await parent.put(switches(phoneId), { checkIns: false });
    expect((await device.get("/api/device/rules")).json.inbox).toMatchObject({ quickMessages: true, checkIns: false });
    await parent.put(switches(phoneId), { quickMessagesEnabled: false });
    expect((await device.get("/api/device/rules")).json.inbox).toMatchObject({ quickMessages: false, checkIns: false });
  });

  it("does not exist on a Myself phone", async () => {
    const { parent, phoneId, device } = await setup("adult@example.org", "self");
    expect((await parent.put(switches(phoneId), { familyInbox: true })).status).toBe(404);
    expect((await parent.get(`/api/phones/${phoneId}/inbox`)).status).toBe(404);
    expect((await device.get("/api/device/inbox")).status).toBe(404);
    expect((await device.get("/api/device/rules")).json.inbox).toBeUndefined();
  });
});

describe("child to parent", () => {
  it("puts a quick message from the inbox in the thread once, with how many devices got it", async () => {
    const { parent, phoneId, device, userId } = await setup();
    await parent.put(switches(phoneId), { familyInbox: true, quickMessagesEnabled: true });
    await subscribe(userId);
    const message = send({});
    expect((await device.post("/api/device/quick-messages/send", message)).json).toEqual({ notified: 1 });
    // A retry after a lost answer neither adds a row nor notifies again.
    expect((await device.post("/api/device/quick-messages/send", message)).json).toEqual({ notified: 1 });
    expect(h.parentPush.sent).toHaveLength(1);
    expect(h.parentPush.sent[0]!.urgent).toBe(false);
    const thread = (await parent.get(`/api/phones/${phoneId}/inbox`)).json;
    expect(thread.messages).toEqual([
      { id: message.id, from: "child", kind: "quick", text: "Pick me up", sentAt: h.clock.now.toISOString(), delivered: 1 },
    ]);
  });

  it("keeps a message sent offline at its original time, and a quick message outside the inbox out of the thread", async () => {
    const { parent, phoneId, device } = await setup();
    await parent.put(switches(phoneId), { familyInbox: true, quickMessagesEnabled: true });
    const late = send({ sentAt: new Date(h.clock.now.getTime() - 3_600_000).toISOString() });
    const now = send({ text: "I'm okay" });
    await device.post("/api/device/quick-messages/send", now);
    h.clock.advance(1_000);
    await device.post("/api/device/quick-messages/send", late);
    // From the SOS screen (no `inbox`): sent as before, not stored (docs/sos.md).
    await device.post("/api/device/quick-messages/send", { id: randomUUID(), text: "Call me" });
    // A clock ahead of the server never puts a message in the future.
    h.clock.advance(1_000);
    await device.post("/api/device/quick-messages/send", send({ text: "Later", sentAt: new Date(h.clock.now.getTime() + 600_000).toISOString() }));
    const thread = (await device.get("/api/device/inbox")).json.messages;
    expect(thread.map((m: { text: string }) => m.text)).toEqual(["Pick me up", "I'm okay", "Later"]);
    expect(thread[0].sentAt).toBe(late.sentAt);
    expect(thread[2].sentAt).toBe(h.clock.now.toISOString());
    // Nobody had push, so the phone sends an SMS; the thread says no device got it.
    expect(thread[0].delivered).toBe(0);
  });

  it("fills in the thread after an offline SMS without notifying again", async () => {
    const { parent, phoneId, device, userId } = await setup();
    await parent.put(switches(phoneId), { familyInbox: true, quickMessagesEnabled: true });
    await subscribe(userId);
    const offline = send({ sentAt: new Date(h.clock.now.getTime() - 600_000).toISOString(), smsSent: true });
    h.clock.advance(3_600_000);
    expect((await device.post("/api/device/quick-messages/send", offline)).json).toEqual({ notified: 0 });
    // A replay of the late report changes nothing either.
    expect((await device.post("/api/device/quick-messages/send", offline)).json).toEqual({ notified: 0 });
    expect(h.parentPush.sent).toEqual([]);
    const [message] = (await parent.get(`/api/phones/${phoneId}/inbox`)).json.messages;
    expect(message).toMatchObject({ id: offline.id, sentAt: offline.sentAt, delivered: 0 });
  });

  it("records what the phone sent after the inbox was switched off in transit", async () => {
    const { parent, phoneId, device } = await setup();
    await parent.put(switches(phoneId), { familyInbox: true, checkIns: true });
    await parent.put(switches(phoneId), { familyInbox: false });
    const answer = await device.post("/api/device/quick-messages/send", send({ kind: "checkin", text: "I'm home" }));
    expect(answer.status).toBe(200);
    const [row] = await h.ctx.db.select().from(familyMessages).where(eq(familyMessages.phoneId, phoneId));
    expect(row).toMatchObject({ kind: "checkin", sender: "child" });
  });

  it("sends a check-in without a position, in the parent's language and never urgent", async () => {
    const { parent, phoneId, device, userId } = await setup();
    await parent.put(switches(phoneId), { familyInbox: true, checkIns: true });
    await subscribe(userId);
    expect((await device.post("/api/device/quick-messages/send", send({ kind: "checkin", text: "Jeg er hjemme" }))).json).toEqual({ notified: 1 });
    expect(h.parentPush.sent[0]!.msg.title).toBe("Sam: I'm home");
    expect(h.parentPush.sent[0]!.urgent).toBe(false);
    const withPosition = send({ kind: "checkin", text: "I'm home", location: { lat: 55.6, lon: 12.5 } });
    expect((await device.post("/api/device/quick-messages/send", withPosition)).status).toBe(400);
  });

  it("keeps code words in the SOS flow: urgent, and never in the thread", async () => {
    const { parent, phoneId, device, userId } = await setup();
    await parent.put(switches(phoneId), { familyInbox: true, quickMessagesEnabled: true });
    await subscribe(userId);
    const code = { id: randomUUID(), kind: "urgent", trigger: "code", message: "Is the blue bike home?" };
    expect((await device.post("/api/device/sos", code)).status).toBe(200);
    await vi.waitFor(() => expect(h.parentPush.sent).toHaveLength(1));
    expect(h.parentPush.sent[0]!.urgent).toBe(true);
    expect((await parent.get(`/api/phones/${phoneId}/inbox`)).json.messages).toEqual([]);
  });
});

describe("parent to child", () => {
  it("refuses a reply while the inbox is off", async () => {
    const { parent, phoneId } = await setup();
    expect((await parent.post(`/api/phones/${phoneId}/inbox`, { text: "On my way" })).status).toBe(403);
  });

  it("wakes the phone, which fetches the reply and sends its device receipt once", async () => {
    const { parent, phoneId, device } = await setup();
    await h.ctx.db.insert(contacts).values([
      { phoneId, name: "Robin", number: "+4520000002", sosParent: true },
      { phoneId, name: "Alex", number: "+4520000001", sosParent: true },
      { phoneId, name: "Kim", number: "+4520000003" },
    ]);
    await parent.put(switches(phoneId), { familyInbox: true });
    await parent.patch(`/api/phones/${phoneId}`, { pushWakeups: true });
    await device.put("/api/device/push-token", { fcmToken: "fcm-1" });
    const wakes = h.push.sent.length;
    const reply = await parent.post(`/api/phones/${phoneId}/inbox`, { text: " On my way ", name: "Alex" });
    expect(reply.status).toBe(201);
    expect(reply.json).toMatchObject({ from: "parent", kind: "reply", text: "On my way", author: "Alex", receivedAt: null });
    expect(h.push.sent.slice(wakes)).toEqual([{ token: "fcm-1", reason: "rules" }]);
    expect((await device.get("/api/device/rules")).json.inbox.latest).toBe(reply.json.id);
    const inbox = (await device.get("/api/device/inbox")).json;
    expect(inbox.recipients).toEqual(["Alex", "Robin"]);
    expect(inbox.messages.map((m: { id: string }) => m.id)).toEqual([reply.json.id]);

    expect((await device.post("/api/device/inbox/received", { ids: [reply.json.id] })).status).toBe(204);
    const first = (await parent.get(`/api/phones/${phoneId}/inbox`)).json.messages[0].receivedAt;
    expect(first).toBe(h.clock.now.toISOString());
    h.clock.advance(60_000);
    await device.post("/api/device/inbox/received", { ids: [reply.json.id] });
    expect((await parent.get(`/api/phones/${phoneId}/inbox`)).json.messages[0].receivedAt).toBe(first);
    expect((await parent.post(`/api/phones/${phoneId}/inbox`, { text: "x".repeat(61) })).status).toBe(400);
  });

  it("keeps households apart: no reading or receipts across phones", async () => {
    const a = await setup("a@example.org");
    const b = await setup("b@example.org");
    for (const p of [a, b]) await p.parent.put(switches(p.phoneId), { familyInbox: true });
    const reply = (await a.parent.post(`/api/phones/${a.phoneId}/inbox`, { text: "Dinner at 18" })).json;
    expect((await b.parent.get(`/api/phones/${a.phoneId}/inbox`)).status).toBe(404);
    expect((await b.parent.post(`/api/phones/${a.phoneId}/inbox`, { text: "Hi" })).status).toBe(404);
    expect((await b.device.get("/api/device/inbox")).json.messages).toEqual([]);
    await b.device.post("/api/device/inbox/received", { ids: [reply.id] });
    expect((await a.parent.get(`/api/phones/${a.phoneId}/inbox`)).json.messages[0].receivedAt).toBeNull();
  });
});

describe("a bounded thread", () => {
  it("keeps the newest 50 and nothing older than 30 days", async () => {
    const { parent, phoneId, device } = await setup();
    await parent.put(switches(phoneId), { familyInbox: true });
    for (let i = 0; i < 52; i++) {
      h.clock.advance(1_000);
      await parent.post(`/api/phones/${phoneId}/inbox`, { text: `Reply ${i}` });
    }
    const rows = await h.ctx.db.select().from(familyMessages).where(eq(familyMessages.phoneId, phoneId));
    expect(rows).toHaveLength(50);
    expect(rows.some((r) => r.text === "Reply 0" || r.text === "Reply 1")).toBe(false);
    const shown = (await device.get("/api/device/inbox")).json.messages;
    expect(shown).toHaveLength(30);
    expect(shown.at(-1).text).toBe("Reply 51");
    h.clock.advance(31 * 86_400_000);
    await sweep(h.ctx);
    expect(await h.ctx.db.select().from(familyMessages).where(eq(familyMessages.phoneId, phoneId))).toEqual([]);
  });
});
