// SPDX-License-Identifier: Apache-2.0
// Findings left open by the 2026-11-20 server audit (docs/audits/2026-11-20-server.md). The clock is
// the harness clock (2026-11-16 12:00 UTC), never the real one.
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { frpAccounts, households, householdMembers, modes, pendingChanges, phones, selfKeys, users } from "../src/db/schema.js";
import { MAX_PENDING_CHANGES } from "../src/services/changes.js";
import { PendingLogins, PendingLoginsFull } from "../src/services/reset-protection.js";
import { verifyMagicLink } from "../src/services/auth.js";
import { Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

const EP = "https://fcm.googleapis.com/fcm/send/";
const keys = { p256dh: "B".repeat(87), auth: "A".repeat(22) };
const subscribe = (c: Client, id: string) =>
  c.post("/api/notifications/subscriptions", { platform: "web", endpoint: EP + id, keys, label: "Chrome on Android" });
const status = (over: Partial<Record<string, unknown>> = {}) => ({
  appVersion: "0.1.3", batteryPct: 80, charging: false, deviceOwner: true, lockIntact: true, maintenance: false,
  failedPolicies: [], rulesEtag: null, rulesAppliedAt: null, dnsHost: null, ...over,
});

describe("the phone's status request does not wait for the alert mails", () => {
  it("answers at once and still pushes when the mail server hangs", async () => {
    const mum = await signIn(h, "mum@example.org");
    await subscribe(mum, "mum");
    const { device } = await pairPhone(h, mum);
    const send = vi.spyOn(h.mail, "send").mockImplementation(() => new Promise(() => {}));
    const started = Date.now();
    const r = await device.put("/api/device/status", status({ lockIntact: false }));
    expect(r.status).toBe(204);
    expect(Date.now() - started).toBeLessThan(2000);
    // The urgent push went out, and the mail was started (it has its own timeout).
    expect(h.parentPush.sent).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("modes routes", () => {
  it("answers 404, not 500, for a malformed id", async () => {
    const mum = await signIn(h, "mum@example.org");
    const { phoneId } = await pairPhone(h, mum);
    const bad = "-".repeat(36);
    expect((await mum.put(`/api/phones/${phoneId}/modes/${bad}`, { name: "x" })).status).toBe(404);
    expect((await mum.del(`/api/phones/${phoneId}/modes/${bad}`)).status).toBe(404);
  });

  it("never stores more than 20 modes under concurrent requests", async () => {
    const mum = await signIn(h, "mum@example.org");
    const { phoneId } = await pairPhone(h, mum);
    const make = (n: number) => mum.post(`/api/phones/${phoneId}/modes`, { name: `Mode ${n}`, preset: "free", allApps: true, contactGroups: [] });
    const seeded = await make(0);
    expect(seeded.status).toBe(201);
    const stored = async () => (await h.ctx.db.select({ id: modes.id }).from(modes).where(eq(modes.phoneId, phoneId))).length;
    const missing = 20 - (await stored()) - 1;
    for (let i = 1; i <= missing; i++) expect((await make(i)).status).toBe(201);
    expect(await stored()).toBe(19);
    const results = await Promise.all([make(100), make(101), make(102)]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await stored()).toBe(20);
  });
});

describe("pending changes", () => {
  async function selfPhone() {
    const me = await signIn(h, "adult@example.org");
    const { phoneId, device } = await pairPhone(h, me, { name: "My phone", profile: "self" });
    await h.ctx.db.update(phones).set({ openMode: false }).where(eq(phones.id, phoneId));
    await device.put("/api/device/apps", { apps: [{ packageName: "com.instagram.android", label: "Instagram" }] });
    return { me, phoneId, device };
  }

  it("stops queueing past the cap and says why", async () => {
    const { me, phoneId } = await selfPhone();
    const op = { type: "app.set", packageName: "com.example.x", allowed: true };
    await h.ctx.db.insert(pendingChanges).values(
      Array.from({ length: MAX_PENDING_CHANGES }, () => ({ phoneId, op, keyType: "delay" as const, effectiveAt: new Date(h.clock.now.getTime() + 86_400_000) })),
    );
    const r = await me.put(`/api/phones/${phoneId}/apps/com.instagram.android`, { allowed: true });
    expect(r.status).toBe(429);
    // A tightening is not queued, so the cap does not stop it.
    expect((await me.put(`/api/phones/${phoneId}/apps/com.instagram.android`, { allowed: false })).status).toBeLessThan(300);
  });

  it("tells the trusted person once an hour, however many requests are queued", async () => {
    const { me, phoneId } = await selfPhone();
    const helper = await signIn(h, "helper@example.org");
    const helperId = (await helper.get("/api/me")).json.user.id;
    await h.ctx.db.update(selfKeys).set({ keyType: "trusted", trustedUserId: helperId, trustedEmail: "helper@example.org" })
      .where(eq(selfKeys.phoneId, phoneId));
    await subscribe(helper, "helper");
    const before = h.mail.outbox.length;
    expect((await me.put(`/api/phones/${phoneId}/apps/com.instagram.android`, { allowed: true })).status).toBe(202);
    expect((await me.put(`/api/phones/${phoneId}/time-limits/total`, { minutes: 600 })).status).toBeLessThan(300);
    await me.put(`/api/phones/${phoneId}/dns/categories/social`, { blocked: false });
    const mails = h.mail.outbox.slice(before).filter((m) => m.to === "helper@example.org");
    expect(mails).toHaveLength(1);
    expect(h.parentPush.sent).toHaveLength(1);
    // Every request still waits for them.
    expect((await helper.get("/api/approvals")).json.approvals.length).toBeGreaterThanOrEqual(2);
  });

  it("counts a Self phone with a device token as connected when it is removed", async () => {
    const me = await signIn(h, "adult@example.org");
    const { phoneId } = await pairPhone(h, me, { name: "My phone", profile: "self" });
    await h.ctx.db.update(phones).set({ pairedAt: null }).where(eq(phones.id, phoneId));
    const r = await me.del(`/api/phones/${phoneId}`);
    expect(r.status).toBe(202);
    expect(r.json.status).toBe("pending");
  });

  it("clears awaitingQrHelper when the key changes to a tightening one", async () => {
    const { me, phoneId } = await selfPhone();
    await h.ctx.db.update(selfKeys).set({ keyType: "trusted", trustedUserId: null, trustedEmail: null, delayHours: 24, payUnlockEnabled: false, payUnlockAmount: 50000, payUnlockRecipient: "plainphone" }).where(eq(selfKeys.phoneId, phoneId));
    const queued = await me.put(`/api/phones/${phoneId}/apps/com.instagram.android`, { allowed: true });
    expect(queued.status).toBe(202);
    const flag = async () => (await h.ctx.db.select({ w: pendingChanges.awaitingQrHelper }).from(pendingChanges).where(eq(pendingChanges.phoneId, phoneId)))[0]!.w;
    expect(await flag()).toBe(true);
    const next = await me.put(`/api/phones/${phoneId}/key`, {
      keyType: "trusted", qrInvite: true, delayHours: 48, payUnlockEnabled: false, payUnlockAmount: 50000, payUnlockRecipient: "plainphone",
    });
    expect(next.status).toBe(200);
    expect(next.json.status).toBe("applied");
    expect(await flag()).toBe(false);
  });
});

describe("emergency-opening reports", () => {
  it("records every report but stops pinging the trusted person past the limit", async () => {
    const me = await signIn(h, "adult@example.org");
    const { phoneId, device } = await pairPhone(h, me, { name: "My phone", profile: "self" });
    const helper = await signIn(h, "friend@example.org");
    const helperId = (await helper.get("/api/me")).json.user.id;
    await h.ctx.db.update(selfKeys).set({ keyType: "trusted", trustedUserId: helperId, trustedEmail: "friend@example.org" }).where(eq(selfKeys.phoneId, phoneId));
    await subscribe(helper, "helper");
    for (let i = 1; i <= 25; i++) {
      const id = `00000000-0000-4000-8000-${String(900 + i).padStart(12, "0")}`;
      const r = await device.post("/api/device/emergency-openings", { id, packageName: "com.spotify.music", openedAt: h.clock.now.toISOString(), minutes: 15 });
      expect(r.status).toBe(204);
    }
    expect((await me.get(`/api/phones/${phoneId}/emergency-openings`)).json.openings).toHaveLength(25);
    expect(h.parentPush.sent).toHaveLength(20);
  });
});

describe("contact suggestions", () => {
  it("refuses more than the 2,000 contacts the phone itself sends", async () => {
    const mum = await signIn(h, "mum@example.org");
    const { phoneId, device } = await pairPhone(h, mum, { profile: "child" });
    await mum.patch(`/api/phones/${phoneId}/contacts`, { suggestDeviceContacts: true });
    const contact = (i: number) => ({ name: `C ${i}`, numbers: [`+45${String(20000000 + i)}`] });
    expect((await device.put("/api/device/contact-suggestions", { contacts: Array.from({ length: 2000 }, (_, i) => contact(i)) })).status).toBe(204);
    expect((await device.put("/api/device/contact-suggestions", { contacts: Array.from({ length: 2001 }, (_, i) => contact(i)) })).status).toBe(400);
  });
});

describe("sign-in and enrolment races", () => {
  it("two first logins of one address at once make one user", async () => {
    const mailOf = async (email: string) => {
      const c = new Client(h);
      await c.post("/api/auth/request", { email, locale: "en" });
      return decodeURIComponent(/#token=([^\s"&<]+)/.exec(h.mail.outbox.at(-1)!.text)![1]!);
    };
    const a = await mailOf("new@example.org");
    const b = await mailOf("new@example.org");
    const results = await Promise.all([verifyMagicLink(h.ctx, a, "en"), verifyMagicLink(h.ctx, b, "en")]);
    expect(results.every((r) => r !== null)).toBe(true);
    expect(results[0]!.user.id).toBe(results[1]!.user.id);
    const rows = await h.ctx.db.select().from(users).where(eq(users.email, "new@example.org"));
    expect(rows).toHaveLength(1);
    const owned = await h.ctx.db.select().from(householdMembers).where(eq(householdMembers.userId, rows[0]!.id));
    expect(owned).toHaveLength(1);
  });
});

describe("reset-protection sign-ins in progress", () => {
  it("lets one account hold only a few and answers when the table is full", () => {
    const pending = new PendingLogins();
    const now = 1_000_000;
    const first = pending.start("u1", "h1", now);
    for (let i = 0; i < 5; i++) pending.start("u1", "h1", now);
    // The oldest of u1's starts gave way; another account is not affected.
    expect(pending.take(first.state, now)).toBeNull();
    // Only a crowd of accounts can fill the table (1,000 places, 3 each), and then the route answers 503.
    expect(() => { for (let i = 0; i < 400; i++) for (let j = 0; j < 3; j++) pending.start(`u${i + 2}`, "h", now); }).toThrow(PendingLoginsFull);
  });
});

describe("removing a member", () => {
  it("also removes their reset-protection account", async () => {
    const mum = await signIn(h, "mum@example.org");
    const dad = await signIn(h, "dad@example.org");
    const hid = (await mum.get("/api/me")).json.households[0].id as string;
    const dadId = (await dad.get("/api/me")).json.user.id as string;
    await h.ctx.db.insert(householdMembers).values({ householdId: hid, userId: dadId, role: "parent" });
    await h.ctx.db.insert(frpAccounts).values({ householdId: hid, userId: dadId, googleAccountId: "123456" });
    expect((await mum.del(`/api/households/${hid}/members/${dadId}`)).status).toBe(204);
    const left = await h.ctx.db.select().from(frpAccounts).where(and(eq(frpAccounts.householdId, hid), eq(frpAccounts.userId, dadId)));
    expect(left).toHaveLength(0);
    void households;
  });
});

describe("claiming a phone as a parent in several households", () => {
  it("needs the household to be named", async () => {
    const mum = await signIn(h, "mum@example.org");
    const hid = (await mum.get("/api/me")).json.households[0].id as string;
    const other = await h.ctx.db.insert(households).values({ name: "Other" }).returning();
    await h.ctx.db.insert(householdMembers).values({ householdId: other[0]!.id, userId: (await mum.get("/api/me")).json.user.id, role: "parent" });
    const device = new Client(h);
    const start = await device.post("/api/device/pairings", { mode: "strong", deviceInfo: { model: "Test" } });
    const claim = (extra: object) => mum.post("/api/phones/claim", { code: start.json.code, name: "Alma", profile: "child", ...extra });
    expect((await claim({})).status).toBe(400);
    expect((await claim({ householdId: hid })).status).toBe(201);
  });
});

describe("update-now wakeups", () => {
  it("are limited per phone", async () => {
    const mum = await signIn(h, "mum@example.org");
    const { phoneId } = await pairPhone(h, mum);
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await mum.post(`/api/phones/${phoneId}/update`)).status;
    expect(last).toBe(429);
  });
});

describe("the setup QR retry", () => {
  it("answers a lost reply, but not once the phone has synced", async () => {
    const parent = await signIn(h, "p@example.org");
    const { enrollment } = (await parent.post("/api/phones/enroll", { name: "Alma", profile: "child" })).json;
    const enroll = () => new Client(h).post("/api/device/enroll", { token: enrollment.token, installId: "install-id-0123456789abcdef", deviceInfo: { model: "Test" } });
    const first = await enroll();
    expect(first.status).toBe(200);
    // The reply was lost: the same install asks again and gets a token.
    const again = await enroll();
    expect(again.status).toBe(200);
    // The phone synced with it, so another ask is not a lost reply any more.
    await h.ctx.db.update(phones).set({ lastSeenAt: h.clock.now }).where(eq(phones.id, first.json.phoneId));
    expect((await enroll()).status).toBe(410);
  });
});
