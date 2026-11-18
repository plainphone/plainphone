// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { maskPairingEmail, pairingAccount } from "../src/services/pairing-account.js";

describe("pairing account", () => {
  const claimer = { id: "claimer", email: "example@example.org" };

  it("returns only the initial and domain", () => {
    expect(maskPairingEmail(claimer.email)).toBe("e***@example.org");
    expect(maskPairingEmail("e@example.org")).toBe("e***@example.org");
    expect(maskPairingEmail("invalid")).toBeNull();
  });

  it("only identifies the person who claimed this pairing", () => {
    expect(pairingAccount(claimer.id, claimer, "Home")).toEqual({
      maskedEmail: "e***@example.org", householdName: "Home",
    });
    expect(pairingAccount(claimer.id, claimer, "EXAMPLE@example.org")).toEqual({
      maskedEmail: "e***@example.org", householdName: null,
    });
    expect(pairingAccount("another-member", claimer, "Home")).toBeNull();
    expect(pairingAccount(null, claimer, "Home")).toBeNull();
  });
});
