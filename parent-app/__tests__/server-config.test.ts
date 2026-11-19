// SPDX-License-Identifier: Apache-2.0
import { normalizeServerUrl, checkServer } from "../src/lib/config";
import { matchesServerLink } from "../src/lib/links";

describe("server selection", () => {
  it("accepts a TLS origin and rejects URL components that can change the target", () => {
    expect(normalizeServerUrl(" https://pp.example.org:8443/ ")).toBe("https://pp.example.org:8443");
    for (const input of ["https://user@pp.example.org", "https://pp.example.org/path",
      "https://pp.example.org?", "https://pp.example.org/#", "https://pp.example.org\\foo"]) {
      expect(() => normalizeServerUrl(input)).toThrow();
    }
  });

  it("limits cleartext to local development", () => {
    expect(normalizeServerUrl("http://plainphone-test.local:8080", true)).toBe("http://plainphone-test.local:8080");
    expect(() => normalizeServerUrl("http://localhost", false)).toThrow();
    expect(() => normalizeServerUrl("http://localhost.example.org", true)).toThrow();
  });

  it("keeps login links on their issuing server", () => {
    const own = "https://pp.example.org";
    expect(matchesServerLink(`${own}/auth/app#token=placeholder`, own, "/auth/app")).toBe(true);
    expect(matchesServerLink(`${own}/auth/app#token=placeholder`, "https://app.plainphone.org", "/auth/app")).toBe(false);
    expect(matchesServerLink(`plainphone://auth/app#token=placeholder&server=${encodeURIComponent(own)}`, own, "/auth/app")).toBe(true);
  });

  it("requires a compatible healthy server", async () => {
    await expect(checkServer("https://pp.example.org", async () =>
      Response.json({ ok: true, compatibility: 1 }))).resolves.toBeUndefined();
    await expect(checkServer("https://pp.example.org", async () =>
      Response.json({ ok: true }))).rejects.toThrow();
  });
});
