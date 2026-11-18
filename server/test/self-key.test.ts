// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { householdMembers, phones, schedules, selfKeys } from "../src/db/schema.js";
import { describe, expect, it } from "vitest";
import { coverage, scheduleLoosens } from "../src/services/changes.js";
import { sweep } from "../src/services/sweeper.js";
import { Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

async function selfPhone() {
  const me = await signIn(h, "adult@example.org");
  const { phoneId, device } = await pairPhone(h, me, { name: "My phone", profile: "self" });
  await device.put("/api/device/apps", {
    apps: [
      { packageName: "com.instagram.android", label: "Instagram" },
      { packageName: "com.spotify.music", label: "Spotify" },
    ],
  });
  return { me, phoneId, device };
}

const allowed = async (device: Awaited<ReturnType<typeof selfPhone>>["device"]) =>
  (await device.get("/api/device/rules")).json.apps.allowed as string[];

describe("Self profile with the delay key", () => {
  it("delays loosening by 24 hours, applies tightening at once", async () => {
    const { me, phoneId, device } = await selfPhone();
    const key = await me.get(`/api/phones/${phoneId}/key`);
    expect(key.json).toMatchObject({ keyType: "delay", delayHours: 24, payUnlockEnabled: false, payUnlockAmount: 50000 });

    const show = await me.put(`/api/phones/${phoneId}/apps/com.instagram.android`, { allowed: true });
    expect(show.status).toBe(202);
    expect(show.json.status).toBe("pending");
    expect(new Date(show.json.change.effectiveAt).getTime() - h.clock.now.getTime()).toBe(24 * 3_600_000);
    expect(await allowed(device)).not.toContain("com.instagram.android");
    // The phone sees the countdown.
    expect((await device.get("/api/device/rules")).json.pendingChanges).toHaveLength(1);

    const hide = await me.put(`/api/phones/${phoneId}/apps/com.spotify.music`, { allowed: false });
    expect(hide.json.status).toBe("applied");
    expect(await allowed(device)).not.toContain("com.spotify.music");

    h.clock.advance(24 * 3_600_000 - 1000);
    expect(await allowed(device)).not.toContain("com.instagram.android");
    h.clock.advance(1000);
    // Applied when the phone next polls, even before the sweeper runs.
    expect(await allowed(device)).toContain("com.instagram.android");
    expect((await me.get(`/api/phones/${phoneId}/changes`)).json.changes).toHaveLength(0);
  });

  it("can be cancelled during the wait", async () => {
    const { me, phoneId, device } = await selfPhone();
    const show = await me.put(`/api/phones/${phoneId}/apps/com.instagram.android`, { allowed: true });
    expect((await me.post(`/api/changes/${show.json.change.id}/cancel`)).status).toBe(204);
    expect((await me.post(`/api/changes/${show.json.change.id}/cancel`)).status).toBe(409);
    h.clock.advance(25 * 3_600_000);
    await sweep(h.ctx);
    expect(await allowed(device)).not.toContain("com.instagram.android");
  });

  it("is applied by the sweeper too", async () => {
    const { me, phoneId } = await selfPhone();
    await me.put(`/api/phones/${phoneId}/dns/categories/social`, { blocked: false });
    h.clock.advance(24 * 3_600_000);
    expect((await sweep(h.ctx)).applied).toBe(1);
    expect((await me.get(`/api/phones/${phoneId}/dns`)).json.blockedCategories).not.toContain("social");
  });

  it("puts changes to the key itself through the key, except a longer delay", async () => {
    const { me, phoneId } = await selfPhone();
    const base = { keyType: "delay", delayHours: 24, trustedEmail: null, payUnlockEnabled: false, payUnlockAmount: 50000, payUnlockRecipient: "plainphone" };
    expect((await me.put(`/api/phones/${phoneId}/key`, { ...base, delayHours: 48 })).json.status).toBe("applied");
    expect((await me.put(`/api/phones/${phoneId}/key`, { ...base, delayHours: 48 * 2 })).status).toBe(400); // max 72
    expect((await me.put(`/api/phones/${phoneId}/key`, { ...base, delayHours: 1 })).json.status).toBe("pending");
    expect((await me.put(`/api/phones/${phoneId}/key`, { ...base, delayHours: 48, payUnlockEnabled: true })).json.status).toBe(
      "pending",
    );
    expect((await me.get(`/api/phones/${phoneId}/key`)).json.delayHours).toBe(48);
  });

  it("classifies schedule edits", () => {
    const s = { kind: "school" as const, days: [1], startMinute: 480, endMinute: 840, allowedPackages: [] };
    expect(scheduleLoosens(s, { ...s, endMinute: 900 })).toBe(false); // longer
    expect(scheduleLoosens(s, { ...s, endMinute: 780 })).toBe(true); // shorter
    expect(scheduleLoosens(s, { ...s, days: [2] })).toBe(true); // moved
    expect(scheduleLoosens(s, { ...s, allowedPackages: ["com.spotify.music"] })).toBe(true);
    // Bedtime across midnight: Monday 21:00 to Tuesday 07:00.
    const night = coverage({ days: [1], startMinute: 1260, endMinute: 420 });
    expect(night[1260]).toBe(1);
    expect(night[1440 + 419]).toBe(1);
    expect(night[1440 + 420]).toBe(0);
    // Sunday night wraps to Monday morning.
    expect(coverage({ days: [7], startMinute: 1380, endMinute: 60 })[30]).toBe(1);
  });

  it("does not offer pay-to-unlock while payments are off", async () => {
    const { me, phoneId } = await selfPhone();
    const show = await me.put(`/api/phones/${phoneId}/apps/com.instagram.android`, { allowed: true });
    expect((await me.get(`/api/phones/${phoneId}/changes`)).json.changes[0].payUnlock).toBeNull();
    expect((await me.post(`/api/changes/${show.json.change.id}/pay-unlock`)).status).toBe(409);
  });
});

describe("Self profile: ways around the key", () => {
  it("cannot remove a Self phone without the key (and re-pair it as a Child)", async () => {
    const { me, phoneId, device } = await selfPhone();
    const r = await me.del(`/api/phones/${phoneId}`);
    expect(r.status).toBe(202);
    expect(r.json.change.op.type).toBe("phone.remove");
    expect((await device.get("/api/device/rules")).status).toBe(200);
    expect(h.dns.clients.size).toBe(1);
    h.clock.advance(24 * 3_600_000);
    // The phone polls before the sweeper runs: the removal applies and it is told so.
    expect((await device.get("/api/device/rules")).status).toBe(401);
    expect(h.dns.clients.size).toBe(0);
    await sweep(h.ctx);
    expect((await device.get("/api/device/rules")).status).toBe(401);
  });

  it("cannot show a hidden app through a school-time window", async () => {
    const { me, phoneId } = await selfPhone();
    await me.put(`/api/phones/${phoneId}/apps/com.spotify.music`, { allowed: false });
    const base = { kind: "school", days: [1], startMinute: 480, endMinute: 840 };
    const hidden = await me.post(`/api/phones/${phoneId}/schedules`, { ...base, allowedPackages: ["com.instagram.android"] });
    expect(hidden.json.status).toBe("pending");
    const none = await me.post(`/api/phones/${phoneId}/schedules`, base);
    expect(none.json.status).toBe("applied");
  });

  it("falls back to the delay while the trusted person has not signed in", async () => {
    const { me, phoneId, device } = await selfPhone();
    const key = { keyType: "trusted", delayHours: 24, trustedEmail: "typo@example.org", payUnlockEnabled: false, payUnlockAmount: 50000, payUnlockRecipient: "plainphone" };
    await me.put(`/api/phones/${phoneId}/key`, key);
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);
    expect((await me.get(`/api/phones/${phoneId}/key`)).json.keyType).toBe("trusted");
    const show = await me.put(`/api/phones/${phoneId}/apps/com.instagram.android`, { allowed: true });
    expect(show.json.change.keyType).toBe("delay");
    h.clock.advance(24 * 3_600_000);
    expect(await allowed(device)).toContain("com.instagram.android");
  });
});

describe("Self profile with a trusted person", () => {
  it("recovers a legacy request with an ineligible household helper after the configured delay", async () => {
    const { me, phoneId, device } = await selfPhone();
    const [phone] = await h.ctx.db.select().from(phones).where(eq(phones.id, phoneId));
    assert.ok(phone);
    const requesterId = (await me.get("/api/me")).json.user.id;
    const helper = await signIn(h, "household-helper@example.org");
    const helperId = (await helper.get("/api/me")).json.user.id;
    await h.ctx.db.insert(householdMembers).values({ householdId: phone.householdId, userId: helperId, role: "parent" });
    await h.ctx.db.update(selfKeys).set({ keyType: "trusted", trustedUserId: helperId, delayHours: 6 })
      .where(eq(selfKeys.phoneId, phoneId));
    const [change] = await h.ctx.db.execute<{ id: string }>(sql`
      insert into pending_changes (phone_id, requested_by, op, key_type)
      values (${phone.id}, ${requesterId}, ${JSON.stringify({ type: "app.set", packageName: "com.instagram.android", allowed: true })}::jsonb, 'trusted')
      returning id`);
    assert.ok(change);
    const migration = await readFile(new URL("../drizzle/0017_self_buddies.sql", import.meta.url), "utf8");
    await h.ctx.db.execute(sql.raw(migration.split("--> statement-breakpoint").at(-1)!));
    const [row] = await h.ctx.db.execute<{ key_type: string; effective_at: string }>(sql`
      select key_type, effective_at from pending_changes where id = ${change.id}`);
    assert.ok(row);
    expect(row.key_type).toBe("delay");
    const deadline = new Date(row.effective_at).getTime();
    expect(deadline - Date.now()).toBeGreaterThan(5 * 3_600_000);
    h.clock.advance(deadline - h.clock.now.getTime() - 1);
    await sweep(h.ctx);
    expect(await allowed(device)).not.toContain("com.instagram.android");
    h.clock.advance(2);
    expect(await allowed(device)).toContain("com.instagram.android");
  });

  it("waits for the trusted person's approval", async () => {
    const { me, phoneId, device } = await selfPhone();
    const key = { keyType: "trusted", delayHours: 24, trustedEmail: "friend@example.org", payUnlockEnabled: false, payUnlockAmount: 50000, payUnlockRecipient: "plainphone" };
    // Switching from delay to trusted is itself a loosening.
    const sw = await me.put(`/api/phones/${phoneId}/key`, key);
    expect(sw.json.status).toBe("pending");
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);
    expect((await me.get(`/api/phones/${phoneId}/key`)).json).toMatchObject({ keyType: "trusted", trustedAccepted: false });
    const invite = h.mail.outbox.at(-1)!;
    expect(invite.to).toBe("friend@example.org");
    expect(invite.subject).toContain("trusted person");

    const friend = await signIn(h, "friend@example.org");
    expect((await me.get(`/api/phones/${phoneId}/key`)).json.trustedAccepted).toBe(true);

    const show = await me.put(`/api/phones/${phoneId}/apps/com.instagram.android`, { allowed: true });
    expect(show.json.status).toBe("pending");
    expect(show.json.change.effectiveAt).toBeNull();
    expect(show.json).not.toHaveProperty("notify");
    const request = h.mail.outbox.at(-1)!;
    expect(request.to).toBe("friend@example.org");
    expect(request.subject).toBe("A request is waiting for your answer");
    expect(request.text).toContain('"My phone"');
    expect(request.text).toContain("/approvals");
    h.clock.advance(100 * 3_600_000);
    await sweep(h.ctx);
    expect(await allowed(device)).not.toContain("com.instagram.android");

    // The owner cannot approve their own request.
    expect((await me.post(`/api/changes/${show.json.change.id}/approve`)).status).toBe(404);
    const list = await friend.get("/api/approvals");
    expect(list.json.approvals).toHaveLength(1);
    expect(list.json.approvals[0]).toMatchObject({
      phoneName: "My phone",
      requestedBy: "adult@example.org",
      appLabel: "Instagram",
    });
    expect((await friend.post(`/api/changes/${show.json.change.id}/approve`, { revision: list.json.approvals[0].revision })).status).toBe(204);
    expect(await allowed(device)).toContain("com.instagram.android");
    // The friend cannot see the phone itself.
    expect((await friend.get(`/api/phones/${phoneId}`)).status).toBe(404);

    const second = await me.put(`/api/phones/${phoneId}/apps/com.instagram.android`, { allowed: false });
    expect(second.json.status).toBe("applied");
    // A mail server that is down never fails the request or loses the change.
    let tried = 0;
    h.mail.send = async () => {
      tried++;
      throw new Error("SMTP down");
    };
    const again = await me.put(`/api/phones/${phoneId}/apps/com.instagram.android`, { allowed: true });
    expect(again.status).toBe(202);
    expect(again.json.status).toBe("pending");
    expect(tried).toBe(1);
    expect((await friend.post(`/api/changes/${again.json.change.id}/reject`)).status).toBe(204);
    expect(await allowed(device)).not.toContain("com.instagram.android");
  });

  it("names the affected apps and total limit in phone and helper approvals", async () => {
    const { me, phoneId, device } = await selfPhone();
    const helper = await signIn(h, "helper@example.org");
    const phone = `/api/phones/${phoneId}`;
    const key = await me.put(`${phone}/key`, {
      keyType: "trusted", delayHours: 24, trustedEmail: "helper@example.org",
      payUnlockEnabled: false, payUnlockAmount: 50000, payUnlockRecipient: "plainphone",
    });
    expect(key.status).toBe(202);
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);
    await me.put(`${phone}/time-limits/total`, { minutes: 30 });
    await me.put(`${phone}/time-limits/apps/com.spotify.music`, { minutes: 10 });
    const appLimit = await me.put(`${phone}/time-limits/apps/com.spotify.music`, { minutes: 20 });
    expect(appLimit.status).toBe(202);
    const otherAppLimit = await me.put(`${phone}/time-limits/apps/com.spotify.music`, { minutes: 60 });
    expect(otherAppLimit.status).toBe(202);
    const limit = await me.put(`${phone}/time-limits/total`, { minutes: 60 });
    expect(limit.status).toBe(202);
    const app = await me.put(`${phone}/apps/com.instagram.android`, { allowed: true });
    expect(app.status).toBe(202);
    const phoneRows = (await device.get("/api/device/approval-challenge")).json.changes;
    const helperRows = (await helper.get("/api/approvals")).json.approvals;
    for (const [change, label] of [
      [appLimit.json.change, "Spotify: 10 → 20 min a day"],
      [otherAppLimit.json.change, "Spotify: 10 → 60 min a day"],
      [limit.json.change, "All apps: 30 → 60 min a day"],
      [app.json.change, "Allow Instagram"],
    ] as const) {
      for (const rows of [phoneRows, helperRows]) {
        expect(rows.find((row: { id: string }) => row.id === change.id)?.summary.en).toBe(label);
      }
      const qr = await device.post("/api/device/approval-challenge", { changeId: change.id });
      expect(qr.json.summary.en).toBe(label);
    }
  });

  it("binds QR approval to the current helper, change and expiry and consumes it on approval", async () => {
    const { me, phoneId, device } = await selfPhone();
    const helper = await signIn(h, "helper@example.org");
    const other = await signIn(h, "other@example.org");
    await me.put(`/api/phones/${phoneId}/key`, {
      keyType: "trusted", delayHours: 24, trustedEmail: "helper@example.org",
      payUnlockEnabled: false, payUnlockAmount: 50000, payUnlockRecipient: "plainphone",
    });
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);
    const request = async () => (await me.put(`/api/phones/${phoneId}/apps/com.instagram.android`, { allowed: true })).json.change.id;
    const first = await request();
    const second = await request();
    const challenge = async () => (await device.post("/api/device/approval-challenge", { changeId: first })).json.challenge;
    const approvals = (await helper.get("/api/approvals")).json.approvals as { id: string; revision: string }[];
    const approve = (client: Client, id: string, token: string) => client.post(`/api/changes/${id}/approve-qr`, {
      challenge: token, revision: approvals.find((a) => a.id === id)?.revision,
    });
    const expired = await challenge();
    expect(typeof expired).toBe("string");
    h.clock.advance(120_000);
    expect((await approve(helper, first, expired)).status).toBe(409);
    const replaced = await challenge();
    const fresh = await challenge();
    expect(fresh).not.toBe(replaced);
    expect((await approve(helper, first, replaced)).status).toBe(409);
    expect((await approve(other, first, fresh)).status).toBe(404);
    expect((await approve(me, first, fresh)).status).toBe(404);
    expect((await approve(helper, second, fresh)).status).toBe(409);
    expect((await approve(helper, first, fresh)).status).toBe(204);
    expect((await approve(helper, first, fresh)).status).toBe(409);
    expect((await helper.get("/api/approvals")).json.approvals.map((a: { id: string }) => a.id)).toEqual([second]);
  });

  it("requires a fresh preview when a limit changes before trusted approval", async () => {
    const { me, phoneId, device } = await selfPhone();
    const helper = await signIn(h, "helper@example.org");
    const phone = `/api/phones/${phoneId}`;
    await me.put(`${phone}/key`, {
      keyType: "trusted", delayHours: 24, trustedEmail: "helper@example.org",
      payUnlockEnabled: false, payUnlockAmount: 50000, payUnlockRecipient: "plainphone",
    });
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);
    await me.put(`${phone}/time-limits/total`, { minutes: 30 });
    const request = await me.put(`${phone}/time-limits/total`, { minutes: 60 });
    const changeId = request.json.change.id;
    const preview = async () => (await helper.get("/api/approvals")).json.approvals[0];
    const scan = async () => (await device.post("/api/device/approval-challenge", { changeId })).json;
    const old = await preview();
    const qr = await scan();
    expect(old.summary.en).toBe("All apps: 30 → 60 min a day");
    await me.put(`${phone}/time-limits/total`, { minutes: 5 });
    const updated = await preview();
    expect(updated.summary.en).toBe("All apps: 5 → 60 min a day");
    const route = `/api/changes/${changeId}/approve`;
    expect((await helper.post(route, { revision: old.revision })).status).toBe(409);
    expect((await helper.post(`${route}-qr`, { challenge: qr.challenge, revision: updated.revision })).status).toBe(409);
    const fresh = await scan();
    expect((await helper.post(`${route}-qr`, { challenge: fresh.challenge, revision: old.revision })).status).toBe(409);
    expect((await helper.post(`${route}-qr`, { challenge: fresh.challenge, revision: updated.revision })).status).toBe(204);
  });

  it("rejects approval after the domain is added to the opposite list", async () => {
    const { me, phoneId } = await selfPhone();
    const helper = await signIn(h, "helper@example.org");
    const phone = `/api/phones/${phoneId}`;
    await me.put(`${phone}/key`, {
      keyType: "trusted", delayHours: 24, trustedEmail: "helper@example.org",
      payUnlockEnabled: false, payUnlockAmount: 50000, payUnlockRecipient: "plainphone",
    });
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);

    const domain = "example.org";
    const request = await me.post(`${phone}/dns/allow`, { domain });
    expect(request.status).toBe(202);
    const id = request.json.change.id;
    const preview = async () => (await helper.get("/api/approvals")).json.approvals.find((row: { id: string }) => row.id === id);
    const before = await preview();
    expect((await me.post(`${phone}/dns/block`, { domain })).status).toBe(200);
    const after = await preview();
    expect(after.revision).not.toBe(before.revision);

    const approve = (revision: string) => helper.post(`/api/changes/${id}/approve`, { revision });
    expect((await approve(before.revision)).status).toBe(409);
    expect((await me.get(`${phone}/dns`)).json.blockDomains).toContain(domain);
    expect((await approve(after.revision)).status).toBe(204);
    expect((await me.get(`${phone}/dns`)).json).toMatchObject({ allowDomains: [domain], blockDomains: [] });
  });

  it("keeps a pending limit when a stale approval follows a core app update", async () => {
    const { me, phoneId, device } = await selfPhone();
    const helper = await signIn(h, "helper@example.org");
    const phone = `/api/phones/${phoneId}`;
    const packageName = "com.instagram.android";
    const limit = `${phone}/time-limits/apps/${packageName}`;
    expect((await me.put(limit, { minutes: 15 })).status).toBe(200);
    await me.put(`${phone}/key`, {
      keyType: "trusted", delayHours: 24, trustedEmail: "helper@example.org",
      payUnlockEnabled: false, payUnlockAmount: 50000, payUnlockRecipient: "plainphone",
    });
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);

    const request = await me.put(limit, { minutes: 30 });
    expect(request.status).toBe(202);
    const id = request.json.change.id;
    const preview = async () => (await helper.get("/api/approvals")).json.approvals[0];
    const before = await preview();
    expect((await device.put("/api/device/apps", { apps: [{ packageName, label: "Instagram", core: true }] })).status).toBe(204);
    expect((await preview()).summary).toEqual(before.summary);
    expect((await helper.post(`/api/changes/${id}/approve`, { revision: before.revision })).status).toBe(409);
    expect(await preview()).toMatchObject({ id });
  });

  it("rejects a stale fingerprint when different schedule rules have the same summary", async () => {
    const { me, phoneId, device } = await selfPhone();
    const helper = await signIn(h, "helper@example.org");
    const phone = `/api/phones/${phoneId}`;
    const bedtime = { kind: "bedtime", days: [1], startMinute: 1260, endMinute: 420 };
    await me.post(`${phone}/schedules`, { ...bedtime, allowedPackages: [] });
    const scheduleId = (await me.get(`${phone}/schedules`)).json.schedules[0].id;
    await device.put("/api/device/apps", { apps: [
      { packageName: "com.example.first", label: "Same app" },
      { packageName: "com.example.second", label: "Same app" },
      { packageName: "com.example.blank", label: "\u200e" },
    ] });
    await me.put(`${phone}/key`, {
      keyType: "trusted", delayHours: 24, trustedEmail: "helper@example.org",
      payUnlockEnabled: false, payUnlockAmount: 50000, payUnlockRecipient: "plainphone",
    });
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);
    await h.ctx.db.update(schedules).set({ allowedPackages: ["com.example.first"] }).where(eq(schedules.id, scheduleId));
    const request = await me.put(`${phone}/schedules/${scheduleId}`, {
      ...bedtime, allowedPackages: ["com.example.blank"],
    });
    expect(request.status).toBe(202);
    const changeId = request.json.change.id;
    const preview = async () => (await helper.get("/api/approvals")).json.approvals[0];
    const before = await preview();
    const qr = (await device.post("/api/device/approval-challenge", { changeId })).json;
    await h.ctx.db.update(schedules).set({ allowedPackages: ["com.example.second"] }).where(eq(schedules.id, scheduleId));
    const after = await preview();
    expect(before.summary).toEqual(after.summary);
    expect(before.revision).not.toBe(after.revision);
    expect(after.summary.en).toContain("com.example.blank");
    const route = `/api/changes/${changeId}/approve`;
    expect((await helper.post(route, { revision: before.revision })).status).toBe(409);
    expect((await helper.post(`${route}-qr`, { challenge: qr.challenge, revision: after.revision })).status).toBe(409);
    expect((await helper.post(route, { revision: after.revision })).status).toBe(204);
  });

  it("refreshes a trusted bonus date after the phone's local midnight", async () => {
    const { me, phoneId, device } = await selfPhone();
    const helper = await signIn(h, "helper@example.org");
    const phone = `/api/phones/${phoneId}`;
    await me.put(`${phone}/key`, {
      keyType: "trusted", delayHours: 24, trustedEmail: "helper@example.org",
      payUnlockEnabled: false, payUnlockAmount: 50000, payUnlockRecipient: "plainphone",
    });
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);
    await me.put(`${phone}/time-limits/total`, { minutes: 30 });
    const request = await me.post(`${phone}/time-limits/bonus`, { packageName: "*", minutes: 15 });
    const changeId = request.json.change.id;
    h.clock.advance((10 * 3600 + 59 * 60 + 30) * 1000); // 23:59:30 in Copenhagen.
    const before = (await helper.get("/api/approvals")).json.approvals[0];
    const oldQr = (await device.post("/api/device/approval-challenge", { changeId })).json;
    expect(oldQr.summary).toEqual(before.summary);
    h.clock.advance(60_000);
    const after = (await helper.get("/api/approvals")).json.approvals[0];
    expect(after.summary.en).not.toBe(before.summary.en);
    const route = `/api/changes/${changeId}/approve`;
    expect((await helper.post(route, { revision: before.revision })).status).toBe(409);
    expect((await helper.post(`${route}-qr`, { challenge: oldQr.challenge, revision: after.revision })).status).toBe(409);
    const phoneChoice = (await device.get("/api/device/approval-challenge")).json.changes[0];
    expect(phoneChoice.summary).toEqual(after.summary);
    expect((await helper.post(route, { revision: after.revision })).status).toBe(204);
    const bonuses = (await device.get("/api/device/rules")).json.timeLimits.bonuses;
    expect(bonuses).toHaveLength(1);
    expect(after.summary.en).toBe(`All apps: add 15 min on ${bonuses[0].date}`);
  });

  it("shares the rule name but none of the contact details with a helper", async () => {
    const { me, phoneId, device } = await selfPhone();
    const friend = await signIn(h, "private-helper@example.org");
    const base = `/api/phones/${phoneId}`;
    await me.put(`${base}/key`, {
      keyType: "trusted", delayHours: 24, trustedEmail: "private-helper@example.org",
      payUnlockEnabled: false, payUnlockAmount: 50000, payUnlockRecipient: "plainphone",
    });
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);
    const request = await me.post(`${base}/contacts`, { name: "Private contact", number: "+12025550123" });
    expect(request.json.change.op).toMatchObject({ type: "contact.add", number: "+12025550123" });
    const second = await me.post(`${base}/contacts`, { name: "Other contact", number: "+12025550124" });
    const { json } = await friend.get("/api/approvals");
    const choices = (await device.get("/api/device/approval-challenge")).json.changes;
    for (const [change, name] of [[request, "Private contact"], [second, "Other contact"]] as const) {
      const changeId = change.json.change.id as string;
      const choice = choices.find((row: { id: string }) => row.id === changeId);
      const qr = await device.post("/api/device/approval-challenge", { changeId });
      expect(choice.summary.en).toContain(name);
      expect(qr.json.summary).toEqual(choice.summary);
      expect(json.approvals.find((row: { id: string }) => row.id === changeId).summary.en)
        .toContain(changeId.slice(0, 8).toUpperCase());
    }
    expect(JSON.stringify(json)).not.toContain("Private contact");
    expect(JSON.stringify(json)).not.toContain("Other contact");
    expect(json.approvals[0].op).toEqual({ type: "contact.add" });
    expect(JSON.stringify(json)).not.toContain("+12025550123");
    expect(JSON.stringify(json)).not.toContain("+12025550124");
    expect((await friend.get(`${base}/contacts`)).status).toBe(404);
  });

  it("supports reciprocal keys and ends an outgoing key only with its current helper", async () => {
    const { me, phoneId } = await selfPhone();
    const friend = await signIn(h, "buddy@example.org");
    const other = await pairPhone(h, friend, { profile: "self", name: "Buddy phone" });
    const key = { keyType: "trusted", delayHours: 24, payUnlockEnabled: false, payUnlockAmount: 50000, payUnlockRecipient: "plainphone" };
    await me.put(`/api/phones/${phoneId}/key`, { ...key, trustedEmail: "buddy@example.org" });
    await friend.put(`/api/phones/${other.phoneId}/key`, { ...key, trustedEmail: "adult@example.org" });
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);
    expect((await me.get("/api/people-i-help")).json.people).toMatchObject([{ id: other.phoneId }]);
    expect((await friend.get("/api/people-i-help")).json.people).toMatchObject([{ id: phoneId }]);
    const stop = await me.put(`/api/phones/${phoneId}/key`, { ...key, keyType: "delay", trustedEmail: null });
    expect(stop.status).toBe(202);
    expect((await friend.get("/api/people-i-help")).json.people).toHaveLength(1);
    const route = `/api/changes/${stop.json.change.id}/approve`;
    expect((await me.post(route)).status).toBe(404);
    const { revision } = (await friend.get("/api/approvals")).json.approvals[0];
    expect((await friend.post(route, { revision })).status).toBe(204);
    expect((await friend.get("/api/people-i-help")).json.people).toEqual([]);
    expect((await me.get("/api/people-i-help")).json.people).toHaveLength(1);
  });

  it("copies editable rule choices without contacts, private domains or a helper relationship", async () => {
    const { me, phoneId } = await selfPhone();
    const stranger = await signIn(h, "template-recipient@example.org");
    const source = `/api/phones/${phoneId}`;
    await me.put(`${source}/time-limits/total`, { minutes: 50, days: { "1": 40 } });
    await me.post(`${source}/schedules`, { kind: "bedtime", days: [1], startMinute: 1260, endMinute: 420, allowedPackages: [] });
    await me.post(`${source}/contacts`, { name: "Private contact", number: "+12025550123" });
    await me.post(`${source}/dns/block`, { domain: "private.example.org" });
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);
    expect((await stranger.post(`${source}/self-template`)).status).toBe(404);
    const shared = await me.post(`${source}/self-template`);
    const template = new URLSearchParams(new URL(shared.json.url).hash.slice(1)).get("template");
    expect((await stranger.post("/api/phones/enroll", { name: "Child", profile: "child", mode: "light", template })).status).toBe(400);
    const device = new Client(h);
    const childDraft = await stranger.post("/api/phones/enroll", { name: "Child draft", profile: "child", mode: "light" });
    expect((await device.post("/api/device/enrollment-template", { token: childDraft.json.enrollment.token, template })).status).toBe(404);
    const imported = await stranger.post("/api/phones/enroll", { name: "Copy", profile: "self", mode: "light" });
    const { token } = imported.json.enrollment;
    for (let i = 0; i < 2; i++) {
      expect((await device.post("/api/device/enrollment-template", { token, template })).status).toBe(204);
    }
    expect(imported.status).toBe(201);
    const copy = `/api/phones/${imported.json.phone.id}`;
    expect((await stranger.get(`${copy}/time-limits`)).json.total).toEqual({ minutes: 50, days: { "1": 40 } });
    expect((await stranger.get(`${copy}/schedules`)).json.schedules).toMatchObject([{ kind: "bedtime", days: [1] }]);
    expect((await stranger.get(`${copy}/apps`)).json.apps).toEqual(expect.arrayContaining([expect.objectContaining({ packageName: "com.instagram.android", allowed: false })]));
    expect((await stranger.get(`${copy}/contacts`)).json.contacts).toEqual([]);
    expect((await stranger.get(`${copy}/dns`)).json.blockDomains).toEqual([]);
    expect((await stranger.get("/api/people-i-help")).json.people).toEqual([]);
    expect((await stranger.put(`${copy}/time-limits/total`, { minutes: 70 })).status).toBe(200);
    expect((await device.post("/api/device/enroll", { token, installId: "template-copy-install" })).json.phoneId).toBe(imported.json.phone.id);
    expect((await device.post("/api/device/enrollment-template", { token, template })).status).toBe(404);
    h.clock.advance(15 * 60_000);
    expect((await stranger.post("/api/phones/enroll", { name: "Expired", profile: "self", template })).status).toBe(404);
  });

  it("refuses yourself as trusted person", async () => {
    const { me, phoneId } = await selfPhone();
    const r = await me.put(`/api/phones/${phoneId}/key`, {
      keyType: "trusted",
      delayHours: 24,
      trustedEmail: "adult@example.org",
      payUnlockEnabled: false,
      payUnlockAmount: 50000,
      payUnlockRecipient: "plainphone",
    });
    expect(r.status).toBe(400);
  });
});

describe("Child profile", () => {
  it("applies loosening at once and has no key", async () => {
    const parent = await signIn(h, "p@example.org");
    const { phoneId, device } = await pairPhone(h, parent);
    await device.put("/api/device/apps", { apps: [{ packageName: "com.instagram.android", label: "Instagram" }] });
    expect((await parent.put(`/api/phones/${phoneId}/apps/com.instagram.android`, { allowed: true })).json.status).toBe(
      "applied",
    );
    expect((await parent.get(`/api/phones/${phoneId}/key`)).status).toBe(404);
  });
});
