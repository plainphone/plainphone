// SPDX-License-Identifier: Apache-2.0
//
// The follow-up to an answer given from a push notification (docs/more-time.md): when the phone has
// applied the bonus, the parent who tapped the button hears it under the same notification tag.
// The clock is the harness's injected one (2026-11-16T12:00Z), so nothing here depends on today.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { moreTimeRequests, users } from "../src/db/schema.js";
import { pairPhone, signIn, useHarness, type Client } from "./harness.js";

const h = useHarness();
const SPOTIFY = "com.spotify.music";

async function setup() {
  const mum = await signIn(h, "mum@example.org");
  await mum.post("/api/notifications/subscriptions", {
    platform: "web",
    endpoint: "https://fcm.googleapis.com/fcm/send/mum",
    keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
  });
  const { phoneId, device } = await pairPhone(h, mum, { name: "Alma" });
  const hid = (await mum.get("/api/me")).json.households[0].id;
  await mum.post(`/api/households/${hid}/invites`, { email: "dad@example.org" });
  const token = decodeURIComponent(/invite#token=(\S+)/.exec(h.mail.outbox.at(-1)!.text)![1]!);
  const dad = await signIn(h, "dad@example.org");
  await dad.post("/api/invites/accept", { token });
  await device.put("/api/device/apps", { apps: [{ packageName: SPOTIFY, label: "Spotify" }] });
  await mum.put(`/api/phones/${phoneId}/time-limits/apps/${SPOTIFY}`, { minutes: 60 });
  h.parentPush.sent.length = 0;
  return { mum, dad, phoneId, device };
}

const status = (etag: string | null, appliedAt: string, over: Record<string, unknown> = {}) => ({
  appVersion: "0.4.0", batteryPct: 64, charging: true, deviceOwner: true, lockIntact: true, maintenance: false,
  failedPolicies: [] as string[], rulesEtag: etag, rulesAppliedAt: appliedAt, rulesReceiptConfirmed: true,
  dnsHost: "k3m2x7q9p4r8t6w2y5z3.dns.plainphone.org", ...over,
});
const answer = (c: Client, phoneId: string, rid: string, a: string, source?: "notification") =>
  c.post(`/api/phones/${phoneId}/more-time-requests/${rid}/answer`, { answer: a, ...(source ? { source } : {}) });
const ask = async (device: Client) => (await device.post("/api/device/more-time-requests", { packageName: SPOTIFY })).json.id as string;
const receipts = () => h.parentPush.sent.filter((s) => s.msg.data?.type === "more-time-receipt");
const currentEtag = async (device: Client) => (await device.get("/api/device/rules")).headers.get("etag");
const report = async (device: Client, appliedAt = h.clock.now.toISOString(), over: Record<string, unknown> = {}) =>
  device.put("/api/device/status", status(await currentEtag(device), appliedAt, over));

describe("receipt after an answer from a notification", () => {
  it("sends a silent 'Active on the phone' under the notification's tag once the phone applied the bonus, and only once", async () => {
    const { mum, phoneId, device } = await setup();
    const rid = await ask(device);
    const first = h.parentPush.sent[0]!.msg;
    expect(first.data!.words).toMatchObject({ wait: "The phone will confirm when it is active.", failed: "Could not answer, open Plainphone" });
    h.parentPush.sent.length = 0;
    expect((await answer(mum, phoneId, rid, "15", "notification")).json).toMatchObject({ won: true, status: "approved" });
    // The answer alone sends nothing: the phone has not confirmed yet.
    expect(h.parentPush.sent).toHaveLength(0);
    h.clock.advance(60_000);
    expect((await report(device)).status).toBe(204);
    expect(receipts()).toHaveLength(1);
    expect(receipts()[0]).toMatchObject({
      endpoint: "https://fcm.googleapis.com/fcm/send/mum",
      msg: {
        title: "Alma", body: "15 more minutes given. Active on the phone at 13:01", tag: first.tag, silent: true,
        url: `/phones/${phoneId}`, data: { type: "more-time-receipt", phoneId, requestId: rid },
      },
    });
    h.clock.advance(60_000);
    await report(device);
    expect(receipts()).toHaveLength(1);
  });

  it("waits for a receipt that matches the rules including the bonus", async () => {
    const { mum, phoneId, device } = await setup();
    const rid = await ask(device);
    const before = await currentEtag(device);
    await answer(mum, phoneId, rid, "60", "notification");
    h.parentPush.sent.length = 0;
    // A report of the older rules is not a receipt for the answer, and neither is an unconfirmed one.
    await device.put("/api/device/status", status(before, h.clock.now.toISOString()));
    await report(device, h.clock.now.toISOString(), { rulesReceiptConfirmed: false });
    expect(receipts()).toHaveLength(0);
    await report(device);
    expect(receipts()[0]!.msg.body).toBe("60 more minutes given. Active on the phone at 13:00");
  });

  it("says to check the phone's clock when it applied the rules 'in the future'", async () => {
    const { mum, phoneId, device } = await setup();
    const rid = await ask(device);
    await answer(mum, phoneId, rid, "15", "notification");
    h.parentPush.sent.length = 0;
    await report(device, new Date(h.clock.now.getTime() + 10 * 60_000).toISOString());
    expect(receipts()[0]!.msg.body).toBe("15 more minutes given. The phone confirmed the rules at 13:00. Check the time on the phone.");
  });

  it("sends nothing for an answer given in the dashboard or a decline, and nothing to the parent who came second", async () => {
    const { mum, dad, phoneId, device } = await setup();
    await answer(mum, phoneId, await ask(device), "15");
    await report(device);
    await answer(mum, phoneId, await ask(device), "no", "notification");
    await report(device);
    expect(receipts()).toHaveLength(0);
    // Dad answers second from his notification: he lost, so nothing is waiting for him.
    const both = await ask(device);
    await answer(mum, phoneId, both, "15");
    expect((await answer(dad, phoneId, both, "60", "notification")).json.won).toBe(false);
    await report(device);
    expect(receipts()).toHaveLength(0);
    expect(await h.ctx.db.select().from(moreTimeRequests).where(eq(moreTimeRequests.id, both))).toEqual([
      expect.objectContaining({ receiptUserId: null }),
    ]);
  });

  it("respects the receipts switch: no promise in the follow-up lines, and no receipt", async () => {
    const { mum, phoneId, device } = await setup();
    await mum.patch(`/api/phones/${phoneId}`, { changeReceiptsEnabled: false });
    h.parentPush.sent.length = 0;
    const rid = await ask(device);
    expect(h.parentPush.sent[0]!.msg.data!.words).not.toHaveProperty("wait");
    await answer(mum, phoneId, rid, "15", "notification");
    await report(device);
    expect(receipts()).toHaveLength(0);
  });

  it("respects a muted phone", async () => {
    const { mum, phoneId, device } = await setup();
    const rid = await ask(device);
    await answer(mum, phoneId, rid, "15", "notification");
    await mum.put(`/api/phones/${phoneId}/notifications`, { enabled: false });
    h.parentPush.sent.length = 0;
    await report(device);
    expect(receipts()).toHaveLength(0);
  });

  it("drops a receipt that comes more than six hours later", async () => {
    const { mum, phoneId, device } = await setup();
    const rid = await ask(device);
    await answer(mum, phoneId, rid, "15", "notification");
    h.parentPush.sent.length = 0;
    h.clock.advance(7 * 3_600_000);
    await report(device);
    expect(receipts()).toHaveLength(0);
  });

  it.each([
    ["da", "15 minutter ekstra givet. Aktive på telefonen kl. 13.00"],
    ["sv", "15 extra minuter givna. Aktiva på telefonen kl. 13:00"],
    ["nb", "15 ekstra minutter gitt. Aktive på telefonen kl. 13:00"],
    ["de", "15 Minuten mehr gewährt. Auf dem Telefon aktiv seit 13:00 Uhr"],
  ])("tells a %s-speaking parent in their language", async (locale, body) => {
    const { mum, phoneId, device } = await setup();
    await h.ctx.db.update(users).set({ locale }).where(eq(users.email, "mum@example.org"));
    const rid = await ask(device);
    await answer(mum, phoneId, rid, "15", "notification");
    h.parentPush.sent.length = 0;
    await report(device);
    expect(receipts()[0]!.msg).toMatchObject({ title: "Alma", body });
  });
});
