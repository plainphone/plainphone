// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { RevocationList } from "../src/services/attestation.js";
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
    // The recorded chains were made for the challenge "challenge".
    h.ctx.attestation = { challenge: () => Buffer.from("challenge"), revocations: new RevocationList(async () => ({ entries: {} })) };
    h.app = createApp(h.ctx);
  });

  it("stores the result and shows it to the parent", async () => {
    const parent = await signIn(h, "mum@example.org");
    const { phoneId, device } = await pairPhone(h, parent);
    expect((await parent.get(`/api/phones/${phoneId}`)).json.attestation).toBeNull();

    const ch = await device.post("/api/device/attestation/challenge");
    expect(ch.status).toBe(200);
    const r = await device.put("/api/device/attestation", { challenge: ch.json.challenge, chain: chainB64("akita-TEE_EC_NONE") });
    expect(r.status).toBe(200);
    expect(r.json.state).toBe("unlocked");
    const summary = (await parent.get(`/api/phones/${phoneId}`)).json;
    expect(summary.attestation).toMatchObject({ state: "unlocked", deviceLocked: false, revocationChecked: true });
    expect(summary.attestation.checkedAt).toBe(h.clock.now.toISOString());

    // The phone says its lock is intact, but an unlocked bootloader overrides that in the dashboard.
    await device.put("/api/device/status", {
      appVersion: "0.1.4", batteryPct: 50, charging: false, deviceOwner: true, lockIntact: true,
      maintenance: false, failedPolicies: [], rulesEtag: null, rulesAppliedAt: null, dnsHost: null,
    });
    const status = (await parent.get(`/api/phones/${phoneId}`)).json.status;
    expect(status.lockIntact).toBe(false);
    expect(status.failedPolicies).toEqual(["hardware attestation: unlocked"]);
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
