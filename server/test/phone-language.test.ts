// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { Client, signIn, useHarness } from "./harness.js";

const h = useHarness();

describe("phone language", () => {
  it("leaves the language unset when an older client omits it", async () => {
    const parent = await signIn(h, "parent@example.org");
    const created = await parent.post("/api/phones/enroll", { name: "Test phone", profile: "child" });
    expect(created.status).toBe(201);
    expect(created.json.phone.language).toBeNull();
  });

  it("validates, syncs and resets the language directly on a Self phone", async () => {
    const parent = await signIn(h, "parent@example.org");
    const enrollPath = "/api/phones/enroll";
    const setup = { name: "Test phone", profile: "self", timezone: "UTC" };
    expect((await parent.post(enrollPath, { ...setup, language: "fr" })).status).toBe(400);
    const created = await parent.post(enrollPath, { ...setup, language: "nb" });
    expect(created.status).toBe(201);
    expect(created.json.phone).toMatchObject({ language: "nb", timezone: "UTC" });
    const path = `/api/phones/${created.json.phone.id}`;
    const device = new Client(h);
    const paired = await device.post("/api/device/enroll", {
      token: created.json.enrollment.token, installId: "test-install-0123456789",
    });
    expect(paired.status).toBe(200);
    device.token = paired.json.deviceToken;
    expect((await device.get("/api/device/rules")).json.language).toBe("nb");
    expect((await parent.patch(path, { language: "de-DE" })).status).toBe(400);
    for (const language of ["da", "en", "sv", "nb", "de", null]) {
      const changed = await parent.patch(path, { language });
      expect(changed.status).toBe(200);
      expect(changed.json.language).toBe(language);
      expect((await device.get("/api/device/rules")).json.language).toBe(language);
    }
  });
});
