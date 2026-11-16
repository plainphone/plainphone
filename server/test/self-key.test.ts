// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { coverage, scheduleLoosens } from "../src/services/changes.js";
import { sweep } from "../src/services/sweeper.js";
import { pairPhone, signIn, useHarness } from "./harness.js";

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
    expect((await friend.post(`/api/changes/${show.json.change.id}/approve`)).status).toBe(204);
    expect(await allowed(device)).toContain("com.instagram.android");
    // The friend cannot see the phone itself.
    expect((await friend.get(`/api/phones/${phoneId}`)).status).toBe(404);

    const second = await me.put(`/api/phones/${phoneId}/apps/com.instagram.android`, { allowed: false });
    expect(second.json.status).toBe("applied");
    const again = await me.put(`/api/phones/${phoneId}/apps/com.instagram.android`, { allowed: true });
    expect((await friend.post(`/api/changes/${again.json.change.id}/reject`)).status).toBe(204);
    expect(await allowed(device)).not.toContain("com.instagram.android");
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
