// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { RevocationList, serialKey } from "../src/services/attestation.js";
import { pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

function chainB64(name: string): string[] {
  const pem = readFileSync(new URL(`./fixtures/attestation/${name}.pem`, import.meta.url), "utf8");
  return [...pem.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)].map((m) =>
    Buffer.from(new X509Certificate(m[0]).raw).toString("base64"),
  );
}

describe("attestation API", () => {
  beforeEach(() => {
    h.clock.now = new Date("2024-10-01T00:00:00Z");
    // The recorded chains were made for the challenge "challenge".
    h.ctx.attestation = { challenge: () => Buffer.from("challenge"), revocations: new RevocationList(async () => ({ entries: {} })) };
    h.app = createApp(h.ctx);
  });

  it("stores the result and shows it to the parent", async () => {
    const parent = await signIn(h, "mum@example.org");
    const { phoneId, device } = await pairPhone(h, parent);
    expect((await parent.get(`/api/phones/${phoneId}`)).json.attestation).toBeNull();

    const green = {
      appVersion: "0.1.4", batteryPct: 50, charging: false, deviceOwner: true, lockIntact: true,
      maintenance: false, failedPolicies: [], rulesEtag: null, rulesAppliedAt: null, dnsHost: null,
    };
    expect((await device.put("/api/device/status", green)).status).toBe(204);
    const mailCount = h.mail.outbox.length;
    const ch = await device.post("/api/device/attestation/challenge");
    expect(ch.status).toBe(200);
    const r = await device.put("/api/device/attestation", { challenge: ch.json.challenge, chain: chainB64("akita-TEE_EC_NONE") });
    expect(r.status).toBe(200);
    expect(r.json.state).toBe("unlocked");
    const summary = (await parent.get(`/api/phones/${phoneId}`)).json;
    expect(summary.attestation).toMatchObject({ state: "unlocked", deviceLocked: false, revocationChecked: true });
    expect(summary.attestation.checkedAt).toBe(h.clock.now.toISOString());

    expect(h.mail.outbox).toHaveLength(mailCount + 1);
    h.clock.advance(60_000);
    const missing = await device.post("/api/device/attestation/challenge");
    expect((await device.put("/api/device/attestation", {
      challenge: missing.json.challenge, chain: [],
    })).json.state).toBe("unverifiable");
    const afterMissing = (await parent.get(`/api/phones/${phoneId}`)).json;
    expect(afterMissing.attestation).toMatchObject({
      state: "unlocked", checkedAt: summary.attestation.checkedAt, lastFailedAt: h.clock.now.toISOString(),
    });
    expect(afterMissing.status.lockIntact).toBe(false);

    // An ordinary green report must neither clear the broken lock nor repeat the alert.
    expect((await device.put("/api/device/status", green)).status).toBe(204);
    const next = await device.post("/api/device/attestation/challenge");
    expect((await device.put("/api/device/attestation", {
      challenge: next.json.challenge, chain: chainB64("akita-TEE_EC_NONE"),
    })).status).toBe(200);
    expect(h.mail.outbox).toHaveLength(mailCount + 1);
    const status = (await parent.get(`/api/phones/${phoneId}`)).json.status;
    expect(status.lockIntact).toBe(false);
    expect(status.failedPolicies).toEqual(["hardware attestation: unlocked"]);
  });

  it("reports missing hardware evidence as unverifiable", async () => {
    const parent = await signIn(h, "mum@example.org");
    const { phoneId, device } = await pairPhone(h, parent);
    const ch = await device.post("/api/device/attestation/challenge");
    expect((await device.put("/api/device/attestation", { challenge: ch.json.challenge, chain: [] })).json)
      .toMatchObject({ state: "unverifiable", revocationChecked: false });
    expect((await parent.get(`/api/phones/${phoneId}`)).json.attestation)
      .toMatchObject({ state: "unverifiable", checkedAt: h.clock.now.toISOString() });
  });

  it("keeps revocation through inconclusive checks and clears it on verified evidence", async () => {
    const chain = chainB64("frankel-TEE_EC_2026");
    const challenge = Buffer.from("MTQ2YWFmMTYtNzgxNC00ZTQ0LWFjZGItZTVkNjUyYTdiNjAy", "base64");
    const serial = serialKey(new X509Certificate(Buffer.from(chain[0]!, "base64")));
    let revoked = true;
    h.ctx.attestation = {
      challenge: () => challenge,
      revocations: new RevocationList(async () => ({ entries: revoked ? { [serial]: { status: "REVOKED" } } : {} })),
    };
    h.app = createApp(h.ctx);
    h.clock.now = new Date("2026-11-16T00:00:00Z");
    const parent = await signIn(h, "mum@example.org");
    const { phoneId, device } = await pairPhone(h, parent);
    const submit = async (evidence: string[]) => {
      const ch = await device.post("/api/device/attestation/challenge");
      return device.put("/api/device/attestation", { challenge: ch.json.challenge, chain: evidence });
    };

    expect((await submit(chain)).json.state).toBe("revoked");
    const checkedAt = h.clock.now.toISOString();
    h.clock.advance(60_000);
    expect((await submit([])).json.state).toBe("unverifiable");
    expect((await parent.get(`/api/phones/${phoneId}`)).json.attestation)
      .toMatchObject({ state: "revoked", checkedAt, lastFailedAt: h.clock.now.toISOString() });

    revoked = false;
    h.clock.advance(60 * 60_000 + 1);
    expect((await submit(chain)).json.state).toBe("verified");
    const { attestation } = (await parent.get(`/api/phones/${phoneId}`)).json;
    expect(attestation).toMatchObject({ state: "verified", checkedAt: h.clock.now.toISOString() });
    expect(attestation).not.toHaveProperty("lastFailedAt");
  });

  it("expires a positive result after 48 hours and keeps the actual check time", async () => {
    const challenge = Buffer.from("MTQ2YWFmMTYtNzgxNC00ZTQ0LWFjZGItZTVkNjUyYTdiNjAy", "base64");
    h.ctx.attestation = { ...h.ctx.attestation!, challenge: () => challenge };
    h.app = createApp(h.ctx);
    h.clock.now = new Date("2026-11-16T00:00:00Z");
    const parent = await signIn(h, "mum@example.org");
    const { phoneId, device } = await pairPhone(h, parent);
    const ch = await device.post("/api/device/attestation/challenge");
    const checkedAt = h.clock.now.toISOString();
    expect((await device.put("/api/device/attestation", {
      challenge: ch.json.challenge, chain: chainB64("frankel-TEE_EC_2026"),
    })).json.state).toBe("verified");
    h.clock.advance(48 * 60 * 60_000 - 1);
    expect((await parent.get(`/api/phones/${phoneId}`)).json.attestation)
      .toMatchObject({ state: "verified", checkedAt });
    h.clock.advance(1);
    expect((await device.put("/api/device/status", {
      appVersion: "0.1.4", batteryPct: 50, charging: false, deviceOwner: true, lockIntact: true,
      maintenance: false, failedPolicies: [], rulesEtag: null, rulesAppliedAt: null, dnsHost: null,
    })).status).toBe(204);
    expect((await parent.get(`/api/phones/${phoneId}`)).json.attestation)
      .toMatchObject({ state: "unverifiable", checkedAt });
  });

  it("uses each challenge once and refuses unknown ones", async () => {
    const parent = await signIn(h, "mum@example.org");
    const { device } = await pairPhone(h, parent);
    const chain = chainB64("akita-TEE_EC_NONE");
    expect((await device.put("/api/device/attestation", { challenge: "Y2hhbGxlbmdl", chain })).status).toBe(409);
    const ch = await device.post("/api/device/attestation/challenge");
    expect((await device.put("/api/device/attestation", { challenge: ch.json.challenge, chain })).status).toBe(200);
    expect((await device.put("/api/device/attestation", { challenge: ch.json.challenge, chain })).status).toBe(409);
  });

  it("refuses a chain made for another challenge or one that does not verify", async () => {
    h.ctx.attestation = { challenge: () => Buffer.from("something else"), revocations: new RevocationList(async () => ({})) };
    h.app = createApp(h.ctx);
    const parent = await signIn(h, "mum@example.org");
    const { device } = await pairPhone(h, parent);
    let ch = await device.post("/api/device/attestation/challenge");
    expect((await device.put("/api/device/attestation", { challenge: ch.json.challenge, chain: chainB64("akita-TEE_EC_NONE") })).status).toBe(400);
    ch = await device.post("/api/device/attestation/challenge");
    expect((await device.put("/api/device/attestation", { challenge: ch.json.challenge, chain: ["AAAA", "AAAA"] })).status).toBe(400);
  });

  it("needs a device token", async () => {
    const parent = await signIn(h, "mum@example.org");
    expect((await parent.post("/api/device/attestation/challenge")).status).toBe(401);
  });
});
