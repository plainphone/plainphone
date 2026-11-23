// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { signIn, useHarness } from "./harness.js";

describe("household name", () => {
  const h = useHarness();

  it("refuses \"Home\", the unnamed household's marker, and keeps the saved name", async () => {
    const parent = await signIn(h, "parent@example.org");
    const hid = (await parent.get("/api/me")).json.households[0].id;
    expect((await parent.patch(`/api/households/${hid}`, { name: "Our family" })).status).toBe(204);

    // Trimmed first, like the forms, so padding does not slip past the rule.
    for (const name of ["Home", "  Home "]) {
      const r = await parent.patch(`/api/households/${hid}`, { name });
      expect(r.status).toBe(400);
      expect(r.json.code).toBe("household_name_reserved");
    }
    expect((await parent.get("/api/me")).json.households[0].name).toBe("Our family");

    // Only the exact marker is reserved; a name that merely contains it is the parent's own.
    for (const name of ["home", "Home sweet home"]) {
      expect((await parent.patch(`/api/households/${hid}`, { name })).status).toBe(204);
      expect((await parent.get("/api/me")).json.households[0].name).toBe(name);
    }
  });
});
