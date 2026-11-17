// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { hashPin, isValidPin, newSalt, provisioningPayload, provisioningQr } from "./provisioning";

const info = {
  adminComponent: "org.plainphone.app/.PlainphoneAdminReceiver",
  downloadUrl: "https://app.plainphone.org/download/android",
  signatureChecksum: "mPJAQkicVVPhhgwsBAZJoNloyyj1Cnln74AnjZDi2LM",
  serverUrl: "https://app.plainphone.org",
  dnsHost: "family.adguard-dns.com",
};

describe("provisioning QR", () => {
  it("hashes the PIN exactly like the app and the script (shared test vector)", async () => {
    // Same vector as MaintenancePinTest.kt and scripts/test_provisioning_qr.py.
    expect(await hashPin("123456", "00112233445566778899aabbccddeeff")).toBe(
      "99b17387ba3d03187c4246371f9763757d6d27c0587d564fcbe5a5e326a94ac5",
    );
  });

  it("accepts PINs of 6 to 12 digits only", () => {
    expect(isValidPin("123456")).toBe(true);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("12345a")).toBe(false);
    expect(isValidPin("1234567890123")).toBe(false);
    expect(newSalt()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("carries what the script's QR carries, plus the token, and never the PIN", async () => {
    const salt = newSalt();
    const pinHash = await hashPin("482913", salt);
    const p = provisioningPayload(info, { enrollmentToken: "pp_e_3q2-7wEvR1q8aZ0sLx9Ywg", pinHash, pinSalt: salt, countryCode: "+45" });
    const pre = "android.app.extra.";
    expect(p[pre + "PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME"]).toBe(info.adminComponent);
    expect(p[pre + "PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION"]).toBe(info.downloadUrl);
    expect(p[pre + "PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM"]).toBe(info.signatureChecksum);
    expect(p[pre + "PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED"]).toBe(true);
    // The hosted service's server and start DNS are the app's defaults, so they are left out.
    expect(p[pre + "PROVISIONING_ADMIN_EXTRAS_BUNDLE"]).toEqual({
      "plainphone.pin_hash": pinHash,
      "plainphone.pin_salt": salt,
      "plainphone.enroll": "pp_e_3q2-7wEvR1q8aZ0sLx9Ywg",
      "plainphone.country_code": "45",
    });
    const { text, version } = provisioningQr(p);
    expect(text).not.toContain("482913");
    // Smaller than the script's QR, which the OnePlus 5T read off a screen (about 800 bytes,
    // version 20): about 690 bytes, version 18 (89 modules).
    expect(text.length).toBeLessThan(700);
    expect(version).toBeLessThanOrEqual(18);
  });

  it("names a self-hoster's server and DNS in the code", () => {
    const own = { ...info, serverUrl: "https://pp.example.org", dnsHost: "dns.example.org", downloadUrl: "https://pp.example.org/download/android" };
    const p = provisioningPayload(own, { enrollmentToken: "pp_e_x", pinHash: "a".repeat(64), pinSalt: "b".repeat(32) });
    const extras = p["android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE"] as Record<string, string>;
    expect(extras["plainphone.server_url"]).toBe("https://pp.example.org");
    expect(extras["plainphone.dns_host"]).toBe("dns.example.org");
    expect(extras["plainphone.country_code"]).toBeUndefined();
    // Still no bigger than the script's QR code: at most version 20 (97 modules).
    expect(provisioningQr(p).version).toBeLessThanOrEqual(20);
  });
});
