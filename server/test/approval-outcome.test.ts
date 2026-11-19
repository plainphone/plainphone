// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { sweep } from "../src/services/sweeper.js";
import { pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

async function setup() {
  const me = await signIn(h, "adult@example.org");
  const { phoneId, device } = await pairPhone(h, me, { name: "Alex Demo", profile: "self" });
  await device.put("/api/device/apps", { apps: [{ packageName: "com.instagram.android", label: "Instagram" }] });
  const helper = await signIn(h, "helper@example.org");
  const second = await signIn(h, "second@example.org");
  await me.put(`/api/phones/${phoneId}/key`, {
    keyType: "trusted", delayHours: 24, trustedEmail: "helper@example.org",
    payUnlockEnabled: false, payUnlockAmount: 50000, payUnlockRecipient: "plainphone",
  });
  h.clock.advance(24 * 3_600_000);
  await sweep(h.ctx);
  const request = async () => {
    const id = (await me.put(`/api/phones/${phoneId}/apps/com.instagram.android`, { allowed: true })).json.change.id as string;
    const revision = ((await helper.get("/api/approvals")).json.approvals as { id: string; revision: string }[]).find((a) => a.id === id)!.revision;
    return { id, revision };
  };
  return { me, phoneId, device, helper, second, request };
}

describe("Deciding a request is idempotent and says what happened", () => {
  it("accepts the same approval twice and refuses the opposite answer with the outcome", async () => {
    const { helper, request } = await setup();
    const { id, revision } = await request();
    expect((await helper.post(`/api/changes/${id}/approve`, { revision })).status).toBe(204);
    expect((await helper.post(`/api/changes/${id}/approve`, { revision })).status).toBe(204);
    const reject = await helper.post(`/api/changes/${id}/reject`);
    expect(reject.status).toBe(409);
    expect(reject.json.outcome).toBe("approvedByYou");
  });

  it("accepts the same rejection twice and refuses an approval afterwards", async () => {
    const { helper, request } = await setup();
    const { id, revision } = await request();
    expect((await helper.post(`/api/changes/${id}/reject`)).status).toBe(204);
    expect((await helper.post(`/api/changes/${id}/reject`)).status).toBe(204);
    const approve = await helper.post(`/api/changes/${id}/approve`, { revision });
    expect(approve.status).toBe(409);
    expect(approve.json.outcome).toBe("declinedByYou");
  });

  it("names a request the owner cancelled, and an expired code", async () => {
    const { me, device, helper, request } = await setup();
    const { id, revision } = await request();
    const { challenge } = (await device.post("/api/device/approval-challenge", { changeId: id })).json;
    h.clock.advance(120_000);
    const expired = await helper.post(`/api/changes/${id}/approve-qr`, { challenge, revision });
    expect(expired.status).toBe(409);
    expect(expired.json.outcome).toBe("codeExpired");
    const stale = await helper.post(`/api/changes/${id}/approve`, { revision: "0".repeat(64) });
    expect(stale.json.outcome).toBe("changed");
    expect((await me.post(`/api/changes/${id}/cancel`)).status).toBe(204);
    const cancelled = await helper.post(`/api/changes/${id}/approve`, { revision });
    expect(cancelled.status).toBe(409);
    expect(cancelled.json.outcome).toBe("cancelled");
  });

  it("shows the phone whether its QR code was answered", async () => {
    const { device, helper, request } = await setup();
    const { id, revision } = await request();
    const state = async () => (await device.get(`/api/device/approval-challenge/${id}`)).json.state;
    expect(await state()).toBe("waiting");
    const { challenge } = (await device.post("/api/device/approval-challenge", { changeId: id })).json;
    expect((await helper.post(`/api/changes/${id}/approve-qr`, { challenge, revision })).status).toBe(204);
    expect(await state()).toBe("approved");
    const other = await request();
    expect((await helper.post(`/api/changes/${other.id}/reject`)).status).toBe(204);
    expect((await device.get(`/api/device/approval-challenge/${other.id}`)).json.state).toBe("declined");
    expect((await device.get("/api/device/approval-challenge/00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });

  it("reports whether the phone has confirmed the rules the server holds", async () => {
    const { me, phoneId, device } = await setup();
    const rules = await device.get("/api/device/rules");
    expect((await me.get(`/api/phones/${phoneId}`)).json.rulesCurrent).toBeNull();
    const status = {
      appVersion: "0.1.12", batteryPct: 80, charging: false, deviceOwner: false, lockIntact: true, maintenance: false,
      failedPolicies: [], rulesEtag: rules.headers.get("etag"), rulesAppliedAt: h.clock.now.toISOString(), dnsHost: null,
    };
    expect((await device.put("/api/device/status", status)).status).toBeLessThan(300);
    expect((await me.get(`/api/phones/${phoneId}`)).json.rulesCurrent).toBe(true);
    await me.put(`/api/phones/${phoneId}/apps/com.instagram.android`, { allowed: true });
    expect((await me.get(`/api/phones/${phoneId}`)).json.rulesCurrent).toBe(false);
  });
});
