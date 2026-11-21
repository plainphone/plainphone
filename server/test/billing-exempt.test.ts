// SPDX-License-Identifier: Apache-2.0
//
// A paywall must never touch locking, release, safety, SOS, 112 or the parents' ability to get a
// phone back (#97). With billing on and a free household far over its limit, every path in
// NEVER_GATED still works. Adding an entry to NEVER_GATED without a check here fails the test.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { households, phones } from "../src/db/schema.js";
import { entitlements, NEVER_GATED } from "../src/services/billing.js";
import { enableBilling } from "./billing-helpers.js";
import { type Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

const status = (rulesEtag: string | null, extra: object = {}) => ({
  appVersion: "0.1.17", batteryPct: 80, charging: false, deviceOwner: true, lockIntact: true, maintenance: false,
  failedPolicies: [], rulesEtag, rulesAppliedAt: h.clock.now.toISOString(), rulesReceiptConfirmed: true, dnsHost: null, ...extra,
});

it("keeps every never-gated path open with billing on and the free plan exceeded", async () => {
  // Phones added while billing was off: three, where the free plan allows one.
  const parent = await signIn(h, "parent@example.org");
  const hid = (await parent.get("/api/me")).json.households[0].id as string;
  const child = await pairPhone(h, parent, { name: "Child" });
  const second = await pairPhone(h, parent, { name: "Second" });
  const self = await pairPhone(h, parent, { name: "Mine", profile: "self", mode: "light" });
  await child.device.put("/api/device/apps", { apps: [{ packageName: "com.spotify.music", label: "Spotify" }] });
  await self.device.put("/api/device/apps", { apps: [{ packageName: "com.spotify.music", label: "Spotify" }] });
  await h.ctx.db.update(phones).set({ openMode: false }).where(eq(phones.id, self.phoneId));

  enableBilling(h);
  const ent = await entitlements(h.ctx, hid);
  expect(ent).toMatchObject({ billing: true, plan: "free", limits: { phones: 1 }, usage: { phones: 3 } });
  // The limit itself does apply to a new phone: proof that billing is really on here.
  expect((await parent.post("/api/phones/enroll", { name: "Fourth", profile: "child" })).status).toBe(402);

  const ok = (r: { status: number }, label: string) => expect(r.status, label).toBeLessThan(300);
  const checks: Record<(typeof NEVER_GATED)[number], () => Promise<void>> = {
    "rules sync and locking (GET /device/rules, PUT /device/status)": async () => {
      for (const d of [child.device, second.device, self.device] as Client[]) {
        const rules = await d.get("/api/device/rules");
        ok(rules, "rules");
        ok(await d.put("/api/device/status", status(rules.headers.get("etag"))), "status");
      }
      // The force-stop guard's report (#198): an overdue lifted step is recorded and alerted, never refused.
      const overdue = { name: "restriction no_modify_accounts", until: new Date(h.clock.now.getTime() - 10 * 60_000).toISOString() };
      const etag = (await child.device.get("/api/device/rules")).headers.get("etag");
      ok(await child.device.put("/api/device/status", status(etag, { liftedPolicies: [overdue] })), "lifted-policies report");
    },
    "release and removal of a phone": async () => {
      ok(await parent.post(`/api/phones/${second.phoneId}/release`), "release");
      expect((await second.device.get("/api/device/rules")).json.release).toBe(true);
      ok(await parent.del(`/api/phones/${second.phoneId}`), "remove");
    },
    "SOS, safety rings and check-ins, 112 and emergency numbers": async () => {
      ok(await child.device.post("/api/device/sos", { id: randomUUID(), kind: "urgent", smsSubmitted: true }), "sos");
      // "Ask a parent to call me" (#197) is a safety request too.
      ok(await parent.put(`/api/phones/${child.phoneId}/sos`, { callbackNumber: "+4500000001", callbackConfirmed: true, callbackRequests: true }), "callback switch");
      ok(await child.device.post("/api/device/callback-requests", { id: randomUUID() }), "callback request");
      ok(await parent.post(`/api/phones/${child.phoneId}/ring`, {}), "ring");
      ok(await parent.post(`/api/phones/${child.phoneId}/checkin`, { minutes: 15 }), "checkin");
      // 112 is dialled by the phone itself; the rules it needs are served above. Its SOS block is intact.
      expect((await child.device.get("/api/device/rules")).json).toHaveProperty("sos");
    },
    "emergency openings on Myself phones": async () => {
      ok(await parent.put(`/api/phones/${self.phoneId}/emergency-openings`, { enabled: false, allowance: 3 }), "switch");
      ok(await self.device.post("/api/device/emergency-openings", {
        id: randomUUID(), packageName: "com.spotify.music", openedAt: h.clock.now.toISOString(), minutes: 15,
      }), "report");
    },
    "pending changes: cancel, approve, reject, the delay key itself": async () => {
      const pending = await parent.put(`/api/phones/${self.phoneId}/apps/com.spotify.music`, { allowed: true });
      expect(pending.json.status).toBe("pending");
      ok(await parent.post(`/api/changes/${pending.json.change.id}/cancel`), "cancel");
      const again = await parent.put(`/api/phones/${self.phoneId}/apps/com.spotify.music`, { allowed: true });
      h.clock.advance(24 * 3_600_000 + 1000);
      expect((await self.device.get("/api/device/rules")).json.apps.allowed).toContain("com.spotify.music");
      expect(again.status).toBe(202);
      ok(await parent.put(`/api/phones/${self.phoneId}/key`, {
        keyType: "delay", delayHours: 48, trustedEmail: null, payUnlockEnabled: false, payUnlockAmount: 50000, payUnlockRecipient: "plainphone",
      }), "longer delay");
    },
    "phone settings and rules edits on existing phones": async () => {
      expect((await parent.put(`/api/phones/${child.phoneId}/apps/com.spotify.music`, { allowed: true })).json.status).toBe("applied");
      ok(await parent.patch(`/api/phones/${child.phoneId}`, { name: "Child phone" }), "rename");
    },
    "moving a phone to another server, and receiving one": async () => {
      ok(await parent.put(`/api/phones/${child.phoneId}/server-move/allow`, { allowed: true }), "allow move");
      ok(await parent.get(`/api/households/${hid}/server-move/phones`), "move list");
    },
    "household members (the parents' reachability and access)": async () => {
      ok(await parent.post(`/api/households/${hid}/invites`, { email: "coparent@example.org" }), "invite");
    },
    "account and data deletion": async () => {
      const other = await signIn(h, "solo@example.org");
      const solo = await pairPhone(h, other, { name: "Solo" });
      await pairPhone(h, other, { name: "Solo 2" }).catch(() => undefined);
      ok(await other.del(`/api/phones/${solo.phoneId}`), "remove own phone");
      ok(await other.call("DELETE", "/api/me", { confirmEmail: "solo@example.org" }), "delete account");
    },
  };
  expect(Object.keys(checks).sort()).toEqual([...NEVER_GATED].sort());
  for (const [label, check] of Object.entries(checks)) {
    try {
      await check();
    } catch (err) {
      throw new Error(`never-gated path failed: ${label}: ${(err as Error).message}`);
    }
  }
  // Still free and over the limit after all of that: nothing above needed a paid plan.
  const [after] = await h.ctx.db.select().from(households).where(eq(households.id, hid));
  expect(after!.plan).toBe("free");
});
