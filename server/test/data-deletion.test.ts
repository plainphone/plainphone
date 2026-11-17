// SPDX-License-Identifier: Apache-2.0
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { dnsDeletions, householdInvites, pendingChanges, phones, users } from "../src/db/schema.js";
import { sweep } from "../src/services/sweeper.js";
import { type Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();
const DAY = 86_400_000;

const deleteMe = (c: Client, confirmEmail: string) => c.call("DELETE", "/api/me", { confirmEmail });

async function invite(from: Client, email: string) {
  const hid = (await from.get("/api/me")).json.households[0].id as string;
  const r = await from.post(`/api/households/${hid}/invites`, { email });
  expect(r.status).toBe(201);
  const token = decodeURIComponent(/invite#token=(\S+)/.exec(h.mail.outbox.at(-1)!.text)![1]!);
  return { hid, token, id: r.json.id as string };
}

async function selfPhone(me: Client) {
  const { phoneId, device } = await pairPhone(h, me, { name: "My phone", profile: "self" });
  await device.put("/api/device/apps", { apps: [{ packageName: "com.instagram.android", label: "Instagram" }] });
  return { phoneId, device };
}

describe("invitations (#8)", () => {
  it("deletes an invitation when it is accepted, and expired ones after a day", async () => {
    const mum = await signIn(h, "mum@example.org");
    const accepted = await invite(mum, "dad@example.org");
    const expired = await invite(mum, "gran@example.org");
    const dad = await signIn(h, "dad@example.org");
    expect((await dad.post("/api/invites/accept", { token: accepted.token })).status).toBe(200);
    let rows = await h.ctx.db.select({ id: householdInvites.id }).from(householdInvites);
    expect(rows.map((r) => r.id)).toEqual([expired.id]);

    // Still listed? No: expired invitations are hidden, and kept one more day.
    h.clock.advance(7 * DAY + 1000);
    await sweep(h.ctx);
    expect(await h.ctx.db.select().from(householdInvites)).toHaveLength(1);
    h.clock.advance(DAY);
    const r = await sweep(h.ctx);
    expect(r.deleted.invites).toBe(1);
    expect(await h.ctx.db.select().from(householdInvites)).toHaveLength(0);
  });

  it("keeps an open invitation", async () => {
    const mum = await signIn(h, "mum@example.org");
    await invite(mum, "dad@example.org");
    h.clock.advance(6 * DAY);
    await sweep(h.ctx);
    expect(await h.ctx.db.select().from(householdInvites)).toHaveLength(1);
  });
});

describe("finished pending changes (#9)", () => {
  it("keeps finished changes for 30 days and pending ones until they are decided", async () => {
    const me = await signIn(h, "adult@example.org");
    const { phoneId } = await selfPhone(me);
    const a = await me.put(`/api/phones/${phoneId}/apps/com.instagram.android`, { allowed: true });
    expect(a.json.status).toBe("pending");
    expect((await me.post(`/api/changes/${a.json.change.id}/cancel`)).status).toBe(204);
    const b = await me.post(`/api/phones/${phoneId}/contacts`, { name: "Friend", number: "+4512345678" });
    expect(b.json.status).toBe("pending");

    h.clock.advance(30 * DAY - 1000);
    await sweep(h.ctx);
    expect(await h.ctx.db.select().from(pendingChanges)).toHaveLength(2);
    h.clock.advance(2000);
    const r = await sweep(h.ctx);
    expect(r.deleted.changes).toBe(1);
    const left = await h.ctx.db.select().from(pendingChanges);
    // The contact change was applied by this sweep (after 24 h). It now starts its own 30 days.
    expect(left).toHaveLength(1);
    expect(left[0]!.id).toBe(b.json.change.id);
    expect(left[0]!.status).toBe("applied");
    h.clock.advance(30 * DAY + 1000);
    await sweep(h.ctx);
    expect(await h.ctx.db.select().from(pendingChanges)).toHaveLength(0);
  });
});

describe("DNS delete retry (#10)", () => {
  it("retries the DNS delete until the DNS service answers", async () => {
    const mum = await signIn(h, "mum@example.org");
    const { phoneId } = await pairPhone(h, mum);
    const [p] = await h.ctx.db.select().from(phones).where(eq(phones.id, phoneId));
    expect(h.dns.clients.has(p!.dnsClientId)).toBe(true);

    h.dns.failNextDelete = 2;
    expect((await mum.del(`/api/phones/${phoneId}`)).status).toBe(200);
    expect(h.dns.clients.has(p!.dnsClientId)).toBe(true);
    expect(await h.ctx.db.select().from(dnsDeletions)).toMatchObject([{ clientId: p!.dnsClientId, attempts: 1 }]);

    // Backs off: right after a failure nothing is tried.
    await sweep(h.ctx);
    expect(await h.ctx.db.select().from(dnsDeletions)).toMatchObject([{ attempts: 1 }]);
    h.clock.advance(3 * 60_000);
    await sweep(h.ctx);
    expect(await h.ctx.db.select().from(dnsDeletions)).toMatchObject([{ attempts: 2 }]);
    h.clock.advance(5 * 60_000);
    const r = await sweep(h.ctx);
    expect(r.dnsDeleted).toBe(1);
    expect(h.dns.clients.has(p!.dnsClientId)).toBe(false);
    expect(await h.ctx.db.select().from(dnsDeletions)).toHaveLength(0);
  });

  it("keeps sweeping after many failed DNS deletes", async () => {
    await h.ctx.db.insert(dnsDeletions).values({ clientId: "abc", attempts: 40, lastAttemptAt: h.clock.now });
    await sweep(h.ctx);
    h.clock.advance(65 * 60_000);
    expect((await sweep(h.ctx)).dnsDeleted).toBe(1);
  });

  it("deletes at once when the DNS service answers", async () => {
    const mum = await signIn(h, "mum@example.org");
    const { phoneId } = await pairPhone(h, mum);
    expect((await mum.del(`/api/phones/${phoneId}`)).status).toBe(200);
    expect(h.dns.clients.size).toBe(0);
    expect(await h.ctx.db.select().from(dnsDeletions)).toHaveLength(0);
  });
});

describe("deleting an account (#11)", () => {
  it("needs the own email address as confirmation", async () => {
    const mum = await signIn(h, "mum@example.org");
    expect((await deleteMe(mum, "someone@example.org")).status).toBe(400);
    expect((await mum.get("/api/me")).status).toBe(200);
  });

  it("deletes a sole household with its phones; the phone gets 401", async () => {
    const mum = await signIn(h, "mum@example.org");
    const { phoneId, device } = await pairPhone(h, mum);
    await invite(mum, "dad@example.org");
    expect((await device.get("/api/device/rules")).status).toBe(200);

    const r = await deleteMe(mum, "Mum@Example.org");
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ householdsDeleted: 1, phonesRemoved: 1 });
    expect((await mum.get("/api/me")).status).toBe(401);
    expect((await device.get("/api/device/rules")).status).toBe(401);
    expect(await h.ctx.db.select().from(phones).where(eq(phones.id, phoneId))).toHaveLength(0);
    expect(await h.ctx.db.select().from(users)).toHaveLength(0);
    expect(await h.ctx.db.select().from(householdInvites)).toHaveLength(0);
    expect(h.dns.clients.size).toBe(0);
    // Signing in again starts from scratch.
    const again = await signIn(h, "mum@example.org");
    expect((await again.get("/api/phones")).json.phones).toEqual([]);
  });

  it("leaves a shared household and its phones to the other parent", async () => {
    const mum = await signIn(h, "mum@example.org");
    const { phoneId, device } = await pairPhone(h, mum);
    const { hid, token } = await invite(mum, "dad@example.org");
    const dad = await signIn(h, "dad@example.org");
    await dad.post("/api/invites/accept", { token });

    const r = await deleteMe(mum, "mum@example.org");
    expect(r.json).toEqual({ householdsDeleted: 0, phonesRemoved: 0 });
    expect((await device.get("/api/device/rules")).status).toBe(200);
    expect((await dad.get(`/api/phones/${phoneId}`)).status).toBe(200);
    const members = await dad.get(`/api/households/${hid}/members`);
    expect(members.json.members).toEqual([expect.objectContaining({ email: "dad@example.org", role: "owner" })]);
    // Dad's own first household (created at sign-in) is untouched too.
    expect((await dad.get("/api/me")).json.households).toHaveLength(2);
  });

  it("never leaves a household without members when both parents delete at once", async () => {
    const mum = await signIn(h, "mum@example.org");
    const { device } = await pairPhone(h, mum);
    const { token } = await invite(mum, "dad@example.org");
    const dad = await signIn(h, "dad@example.org");
    await dad.post("/api/invites/accept", { token });
    const [a, b] = await Promise.all([deleteMe(mum, "mum@example.org"), deleteMe(dad, "dad@example.org")]);
    expect([a.status, b.status]).toEqual([200, 200]);
    // The second deletion saw a household of one and took the phone with it.
    expect(a.json.phonesRemoved + b.json.phonesRemoved).toBe(1);
    expect((await device.get("/api/device/rules")).status).toBe(401);
    expect(await h.ctx.db.select().from(phones)).toHaveLength(0);
  });

  it("cancels a waiting key change that names the deleted person", async () => {
    const me = await signIn(h, "adult@example.org");
    const { phoneId } = await selfPhone(me);
    const key = { keyType: "trusted", delayHours: 24, trustedEmail: "friend@example.org", payUnlockEnabled: false, payUnlockAmount: 50000, payUnlockRecipient: "plainphone" };
    expect((await me.put(`/api/phones/${phoneId}/key`, key)).json.status).toBe("pending");
    const friend = await signIn(h, "friend@example.org");
    expect((await deleteMe(friend, "friend@example.org")).status).toBe(200);
    expect((await me.get(`/api/phones/${phoneId}/changes`)).json.changes).toHaveLength(0);
  });

  it("refuses while a sole household holds a Self phone, until it is removed through the key", async () => {
    const me = await signIn(h, "adult@example.org");
    const { phoneId, device } = await selfPhone(me);
    const r = await deleteMe(me, "adult@example.org");
    expect(r.status).toBe(409);
    expect(r.json.selfPhoneIds).toEqual([phoneId]);

    const rm = await me.del(`/api/phones/${phoneId}`);
    expect(rm.json.status).toBe("pending");
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);
    expect((await device.get("/api/device/rules")).status).toBe(401);
    expect((await deleteMe(me, "adult@example.org")).status).toBe(200);
  });

  it("turns a key held by the deleted person into the delay", async () => {
    const me = await signIn(h, "adult@example.org");
    const { phoneId, device } = await selfPhone(me);
    const key = { keyType: "trusted", delayHours: 24, trustedEmail: "friend@example.org", payUnlockEnabled: false, payUnlockAmount: 50000, payUnlockRecipient: "plainphone" };
    await me.put(`/api/phones/${phoneId}/key`, key);
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);
    const friend = await signIn(h, "friend@example.org");
    const show = await me.put(`/api/phones/${phoneId}/apps/com.instagram.android`, { allowed: true });
    expect(show.json.change.keyType).toBe("trusted");

    expect((await deleteMe(friend, "friend@example.org")).status).toBe(200);
    expect((await me.get(`/api/phones/${phoneId}/key`)).json).toMatchObject({ keyType: "delay", trustedEmail: null });
    const [waiting] = await me.get(`/api/phones/${phoneId}/changes`).then((r) => r.json.changes);
    expect(waiting.keyType).toBe("delay");
    h.clock.advance(24 * 3_600_000);
    await sweep(h.ctx);
    expect((await device.get("/api/device/rules")).json.apps.allowed).toContain("com.instagram.android");
  });
});
