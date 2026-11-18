// SPDX-License-Identifier: Apache-2.0
//
// Recorded chains from github.com/android/keyattestation (Apache-2.0), testdata/.
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bootVerdict, ChallengeMismatch, RevocationList, serialKey, verifyAttestation } from "../src/services/attestation.js";

function chain(name: string): Buffer[] {
  const pem = readFileSync(new URL(`./fixtures/attestation/${name}.pem`, import.meta.url), "utf8");
  return [...pem.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)].map((m) =>
    Buffer.from(new X509Certificate(m[0]).raw),
  );
}
const b64 = (s: string) => Buffer.from(s, "base64");

const sonyTime = Date.parse("2026-05-23T00:00:00Z");
const akitaTime = Date.parse("2024-10-01T00:00:00Z");
const frankelTime = Date.parse("2026-11-16T00:00:00Z");

describe("key attestation", () => {
  it("rejects a signed path whose intermediate has no certificate signing authority", () => {
    const r = verifyAttestation(chain("sony-xperia10-iii-TEE_EC"), b64("Pq/k1d0AkN5aQrQytCSBr1zimWNlayWExZpJLeFtAMk="), new Set(), sonyTime);
    expect(r.state).toBe("unverifiable");
  });

  it("accepts the 2026 EC root", () => {
    const r = verifyAttestation(chain("frankel-TEE_EC_2026"), b64("MTQ2YWFmMTYtNzgxNC00ZTQ0LWFjZGItZTVkNjUyYTdiNjAy"), new Set(), frankelTime);
    expect(r).toMatchObject({ state: "verified", securityLevel: "tee", deviceLocked: true, verifiedBootState: "verified" });
    expect(r.osPatchLevel).toBeGreaterThan(202000);
  });

  it("reports an unlocked bootloader", () => {
    const r = verifyAttestation(chain("akita-TEE_EC_NONE"), Buffer.from("challenge"), new Set(), akitaTime);
    expect(r).toMatchObject({ state: "unlocked", deviceLocked: false, verifiedBootState: "unverified" });
  });

  it("cannot verify a software keystore", () => {
    const r = verifyAttestation(chain("marlin-TEE_EC_NONE"), Buffer.from("challenge"), new Set());
    expect(r.state).toBe("unverifiable");
    expect(r.deviceLocked).toBeNull();
  });

  it("marks a chain with a revoked certificate", () => {
    const c = chain("sony-xperia10-iii-TEE_EC");
    const intermediate = new X509Certificate(c[1]!);
    const r = verifyAttestation(c, b64("Pq/k1d0AkN5aQrQytCSBr1zimWNlayWExZpJLeFtAMk="), new Set([serialKey(intermediate)]));
    expect(r.state).toBe("unverifiable");
  });

  it.each([
    [false, "verified", true, "unverifiable"],
    [true, "verified", true, "verified"],
    [true, "verified", false, "unverifiable"],
    [false, "unverified", true, "unlocked"],
    [true, "unverified", true, "unlocked"],
    [false, "failed", true, "failed-boot"],
    [true, "failed", true, "failed-boot"],
    [true, "self-signed", true, "custom-os"],
    [false, "self-signed", true, "custom-os"],
    [false, null, true, "unverifiable"],
  ] as const)("classifies locked=%s, boot=%s, revocation checked=%s", (locked, boot, checked, state) => {
    expect(bootVerdict(locked, boot, checked)).toBe(state);
  });

  it("refuses a record made for another challenge, and a chain that does not link up", () => {
    expect(() => verifyAttestation(chain("akita-TEE_EC_NONE"), Buffer.from("other"), new Set())).toThrow(ChallengeMismatch);
    const c = chain("akita-TEE_EC_NONE");
    const broken = [c[0]!, ...chain("sony-xperia10-iii-TEE_EC").slice(1)];
    expect(() => verifyAttestation(broken, Buffer.from("challenge"), new Set())).toThrow(/not signed/);
  });

  it("does not mark a locked phone verified without a revocation list", () => {
    const result = verifyAttestation(
      chain("frankel-TEE_EC_2026"),
      b64("MTQ2YWFmMTYtNzgxNC00ZTQ0LWFjZGItZTVkNjUyYTdiNjAy"),
      null,
      frankelTime,
    );
    expect(result).toMatchObject({ state: "unverifiable", revocationChecked: false });
  });

  it("rejects a valid chain after its issuing certificates expire", () => {
    const result = verifyAttestation(
      chain("frankel-TEE_EC_2026"),
      b64("MTQ2YWFmMTYtNzgxNC00ZTQ0LWFjZGItZTVkNjUyYTdiNjAy"),
      new Set(),
      Date.parse("2026-11-22T00:00:00Z"),
    );
    expect(result.state).toBe("unverifiable");
  });

  it("drops a cached revocation list once its refresh fails", async () => {
    let offline = false;
    const list = new RevocationList(async () => {
      if (offline) throw new Error("offline");
      return { entries: {} };
    });
    expect(await list.get(0)).toEqual(new Set());
    offline = true;
    expect(await list.get(60 * 60_000)).toBeNull();
  });

  it("says when the revocation list could not be fetched", async () => {
    const list = new RevocationList(async () => {
      throw new Error("offline");
    });
    const revoked = await list.get(Date.now());
    expect(revoked).toBeNull();
    expect(verifyAttestation(chain("akita-TEE_EC_NONE"), Buffer.from("challenge"), revoked).revocationChecked).toBe(false);
    const ok = new RevocationList(async () => ({ entries: { "00ABC": { status: "REVOKED" } } }));
    expect([...(await ok.get(0))!]).toEqual(["abc"]);
  });
});
