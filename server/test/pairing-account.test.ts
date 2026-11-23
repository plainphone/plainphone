// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { DEFAULT_HOUSEHOLD_NAME, maskPairingEmail, pairingAccount } from "../src/services/pairing-account.js";

describe("pairing account", () => {
  const claimer = { id: "claimer", email: "example@example.org" };

  it("returns only the initial and domain", () => {
    expect(maskPairingEmail(claimer.email)).toBe("e***@example.org");
    expect(maskPairingEmail("e@example.org")).toBe("e***@example.org");
    expect(maskPairingEmail("invalid")).toBeNull();
  });

  it("only identifies the person who claimed this pairing", () => {
    expect(pairingAccount(claimer.id, claimer, "The Example family")).toEqual({
      maskedEmail: "e***@example.org", householdName: "The Example family",
    });
    expect(pairingAccount(claimer.id, claimer, "EXAMPLE@example.org")).toEqual({
      maskedEmail: "e***@example.org", householdName: null,
    });
    expect(pairingAccount("another-member", claimer, "Home")).toBeNull();
    expect(pairingAccount(null, claimer, "Home")).toBeNull();
  });

  it("shows the phone no name for a household nobody has named yet", () => {
    expect(pairingAccount(claimer.id, claimer, DEFAULT_HOUSEHOLD_NAME)).toEqual({
      maskedEmail: "e***@example.org", householdName: null,
    });
  });
});
