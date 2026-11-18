// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { coverage, scheduleLoosens } from "../src/services/changes.js";
import { sweep } from "../src/services/sweeper.js";
import { type Client, pairPhone, signIn, useHarness } from "./harness.js";

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
    const approve = (client: Client, id: string, token: string) => client.post(`/api/changes/${id}/approve-qr`, { challenge: token });
    const expired = await challenge();
    expect(typeof expired).toBe("string");
    h.clock.advance(120_000);
    expect((await approve(helper, first, expired)).status).toBe(409);
    const fresh = await challenge();
    expect((await approve(other, first, fresh)).status).toBe(404);
    expect((await approve(me, first, fresh)).status).toBe(404);
    expect((await approve(helper, second, fresh)).status).toBe(409);
    expect((await approve(helper, first, fresh)).status).toBe(204);
    expect((await approve(helper, first, fresh)).status).toBe(409);
    expect((await helper.get("/api/approvals")).json.approvals.map((a: { id: string }) => a.id)).toEqual([second]);
  });

  it("shares the rule name but none of the contact details with a helper", async () => {
    const { me, phoneId } = await selfPhone();
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
    const { json } = await friend.get("/api/approvals");
    expect(json.approvals[0].op).toEqual({ type: "contact.add" });
    expect(JSON.stringify(json)).not.toContain("+12025550123");
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
    expect((await friend.post(route)).status).toBe(204);
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
    const imported = await stranger.post("/api/phones/enroll", { name: "Copy", profile: "self", mode: "light", template });
    expect(imported.status).toBe(201);
    const copy = `/api/phones/${imported.json.phone.id}`;
    expect((await stranger.get(`${copy}/time-limits`)).json.total).toEqual({ minutes: 50, days: { "1": 40 } });
    expect((await stranger.get(`${copy}/schedules`)).json.schedules).toMatchObject([{ kind: "bedtime", days: [1] }]);
    expect((await stranger.get(`${copy}/apps`)).json.apps).toEqual(expect.arrayContaining([expect.objectContaining({ packageName: "com.instagram.android", allowed: false })]));
    expect((await stranger.get(`${copy}/contacts`)).json.contacts).toEqual([]);
    expect((await stranger.get(`${copy}/dns`)).json.blockDomains).toEqual([]);
    expect((await stranger.get("/api/people-i-help")).json.people).toEqual([]);
    expect((await stranger.put(`${copy}/time-limits/total`, { minutes: 70 })).status).toBe(200);
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
