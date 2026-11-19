// SPDX-License-Identifier: Apache-2.0
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { phones } from "../src/db/schema.js";
import { type Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

async function setup(profile: "child" | "self" = "child", email = "mum@example.org") {
  const mum = await signIn(h, email);
  await mum.post("/api/notifications/subscriptions", {
    platform: "web",
    endpoint: `https://fcm.googleapis.com/fcm/send/${email}`,
    keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
  });
  const { phoneId, device } = await pairPhone(h, mum, { name: "Alma", profile });
  await h.ctx.db.update(phones).set({ openMode: false }).where(eq(phones.id, phoneId));
  await device.put("/api/device/apps", {
    apps: [
      { packageName: "com.android.dialer", label: "Phone", core: true },
      { packageName: "com.example.game", label: "Game" },
    ],
  });
  return { mum, phoneId, device };
}

const allowed = async (device: Client) => (await device.get("/api/device/rules")).json.apps.allowed as string[];

describe("silent bedtime and approval with the PIN: the switches", () => {
  it("both default to on and reach the phone in the rules", async () => {
    const { mum, phoneId, device } = await setup();
    expect((await mum.get(`/api/phones/${phoneId}`)).json).toMatchObject({ silentBedtime: true, pinApprovalEnabled: true });
    expect((await device.get("/api/device/rules")).json).toMatchObject({ silentBedtime: true, pinApprovalEnabled: true });
  });

  it("turning them off changes the rules and nothing else", async () => {
    const { mum, phoneId, device } = await setup();
    const before = (await device.get("/api/device/rules")).json.rulesRevision;
    const res = await mum.patch(`/api/phones/${phoneId}`, { silentBedtime: false, pinApprovalEnabled: false });
    expect(res.json).toMatchObject({ silentBedtime: false, pinApprovalEnabled: false });
    const rules = (await device.get("/api/device/rules")).json;
    expect(rules).toMatchObject({ silentBedtime: false, pinApprovalEnabled: false });
    expect(rules.rulesRevision).not.toBe(before);
    expect((await mum.patch(`/api/phones/${phoneId}`, { silentBedtime: "no" })).status).toBe(400);
    await mum.patch(`/api/phones/${phoneId}`, { silentBedtime: true });
    expect((await device.get("/api/device/rules")).json).toMatchObject({ silentBedtime: true, pinApprovalEnabled: false });
  });

  it("a Self phone never offers approval on the phone", async () => {
    const { device } = await setup("self");
    expect((await device.get("/api/device/rules")).json.pinApprovalEnabled).toBe(false);
  });
});

describe("approving a request on the phone with the parent PIN", () => {
  it("applies the change, tells the parents and shows as approved on the phone", async () => {
    const { mum, phoneId, device } = await setup();
    const r = await device.post("/api/device/requests", { kind: "app", packageName: "com.example.game" });
    h.parentPush.sent.length = 0;
    const done = await device.post(`/api/device/requests/${r.json.id}/approve-on-phone`, {});
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({ id: r.json.id, status: "approved", decidedVia: "phone", won: true });
    expect(await allowed(device)).toContain("com.example.game");
    expect(h.parentPush.sent.map((s) => s.msg)).toEqual([
      expect.objectContaining({ title: "Approved on Alma", url: `/phones/${phoneId}` }),
    ]);
    expect((await mum.get(`/api/phones/${phoneId}/requests`)).json.requests).toEqual([]);
    expect((await device.get("/api/device/requests")).json.requests[0]).toMatchObject({ status: "approved", decidedVia: "phone" });
  });

  it("is idempotent: a repeat changes nothing and tells nobody", async () => {
    const { device } = await setup();
    const r = await device.post("/api/device/requests", { kind: "contact", name: "Gran", number: "+4512345678" });
    await device.post(`/api/device/requests/${r.json.id}/approve-on-phone`, {});
    h.parentPush.sent.length = 0;
    const again = await device.post(`/api/device/requests/${r.json.id}/approve-on-phone`, {});
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ status: "approved", decidedVia: "phone", won: false });
    expect(h.parentPush.sent).toEqual([]);
    expect((await device.get("/api/device/rules")).json.contacts).toHaveLength(1);
  });

  it("first answer wins: a parent who answered first keeps the answer", async () => {
    const { mum, phoneId, device } = await setup();
    const r = await device.post("/api/device/requests", { kind: "app", packageName: "com.example.game" });
    expect((await mum.post(`/api/phones/${phoneId}/requests/${r.json.id}/reject`, {})).status).toBe(204);
    const late = await device.post(`/api/device/requests/${r.json.id}/approve-on-phone`, {});
    expect(late.status).toBe(200);
    expect(late.json).toMatchObject({ status: "rejected", won: false });
    expect(await allowed(device)).not.toContain("com.example.game");
  });

  it("a parent who answers after the phone is told it was approved on the phone", async () => {
    const { mum, phoneId, device } = await setup();
    const r = await device.post("/api/device/requests", { kind: "app", packageName: "com.example.game" });
    await device.post(`/api/device/requests/${r.json.id}/approve-on-phone`, {});
    const approve = await mum.post(`/api/phones/${phoneId}/requests/${r.json.id}/approve`, {});
    expect(approve.status).toBe(409);
    expect(approve.json.outcome).toBe("approvedOnPhone");
    const reject = await mum.post(`/api/phones/${phoneId}/requests/${r.json.id}/reject`, {});
    expect(reject.status).toBe(409);
    expect(reject.json.outcome).toBe("approvedOnPhone");
  });

  it("tells a parent who answered twice what they answered", async () => {
    const { mum, phoneId, device } = await setup();
    const r = await device.post("/api/device/requests", { kind: "app", packageName: "com.example.game" });
    await mum.post(`/api/phones/${phoneId}/requests/${r.json.id}/approve`, {});
    const again = await mum.post(`/api/phones/${phoneId}/requests/${r.json.id}/approve`, {});
    expect(again.status).toBe(409);
    expect(again.json.outcome).toBe("approvedByYou");
  });

  it("records the report even if the switch was turned off a moment ago", async () => {
    const { mum, phoneId, device } = await setup();
    const r = await device.post("/api/device/requests", { kind: "app", packageName: "com.example.game" });
    await mum.patch(`/api/phones/${phoneId}`, { pinApprovalEnabled: false });
    const done = await device.post(`/api/device/requests/${r.json.id}/approve-on-phone`, {});
    expect(done.json).toMatchObject({ status: "approved", won: true });
  });

  it("shows the parent what was answered, and where, for three days", async () => {
    const { mum, phoneId, device } = await setup();
    const r = await device.post("/api/device/requests", { kind: "app", packageName: "com.example.game" });
    await device.post(`/api/device/requests/${r.json.id}/approve-on-phone`, {});
    const list = (await mum.get(`/api/phones/${phoneId}/requests`)).json;
    expect(list.requests).toEqual([]);
    expect(list.recent).toEqual([expect.objectContaining({ id: r.json.id, appLabel: "Game", status: "approved", decidedVia: "phone" })]);
    h.clock.advance(4 * 86_400_000);
    expect((await mum.get(`/api/phones/${phoneId}/requests`)).json.recent).toEqual([]);
  });

  it("is only for child phones", async () => {
    const { device } = await setup("self");
    const r = await device.post("/api/device/requests", { kind: "app", packageName: "com.example.game" });
    expect((await device.post(`/api/device/requests/${r.json.id}/approve-on-phone`, {})).status).toBe(409);
    expect((await device.get("/api/device/requests")).json.requests[0].status).toBe("pending");
  });

  it("answers 404 for a request the phone does not have", async () => {
    const { device } = await setup();
    expect((await device.post("/api/device/requests/00000000-0000-4000-8000-000000000000/approve-on-phone", {})).status).toBe(404);
  });
});

describe("approving a request for more time on the phone with the parent PIN", () => {
  async function askForMoreTime() {
    const s = await setup();
    await s.mum.put(`/api/phones/${s.phoneId}/time-limits/apps/com.example.game`, { minutes: 30 });
    const r = await s.device.post("/api/device/more-time-requests", { packageName: "com.example.game" });
    h.parentPush.sent.length = 0;
    return { ...s, id: r.json.id as string };
  }

  it("grants 15 minutes, tells the parents and shows as approved on the phone", async () => {
    const { mum, phoneId, device, id } = await askForMoreTime();
    const done = await device.post(`/api/device/requests/${id}/approve-on-phone`, {});
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({ id, status: "approved", answer: "15", grantedMinutes: 15, decidedVia: "phone", won: true });
    const bonuses = (await device.get("/api/device/rules")).json.timeLimits.bonuses as { packageName: string; minutes: number }[];
    expect(bonuses).toEqual([expect.objectContaining({ packageName: "com.example.game", minutes: 15 })]);
    expect(h.parentPush.sent.map((s) => s.msg)).toEqual([expect.objectContaining({ title: "Approved on Alma", url: `/phones/${phoneId}` })]);
    expect((await mum.get(`/api/phones/${phoneId}/more-time-requests`)).json.requests[0]).toMatchObject({ status: "approved", decidedVia: "phone" });
  });

  it("is idempotent, and a parent who answered first keeps the answer", async () => {
    const { mum, phoneId, device, id } = await askForMoreTime();
    await mum.post(`/api/phones/${phoneId}/more-time-requests/${id}/answer`, { answer: "no" });
    h.parentPush.sent.length = 0;
    const late = await device.post(`/api/device/requests/${id}/approve-on-phone`, {});
    expect(late.status).toBe(200);
    expect(late.json).toMatchObject({ status: "declined", decidedVia: "parent", won: false });
    expect(h.parentPush.sent).toEqual([]);
    expect(((await device.get("/api/device/rules")).json.timeLimits.bonuses as unknown[]).length).toBe(0);
  });
});
