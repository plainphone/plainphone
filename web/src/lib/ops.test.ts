// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { makeT } from "@plainphone/i18n/translate";
import { describeOp } from "./ops";

describe("describeOp", () => {
  it("says what releasing a phone does, in both languages", () => {
    expect(describeOp({ type: "phone.release" }, makeT("en"), "en")).toBe("Release the phone: Plainphone switches itself off on it");
    expect(describeOp({ type: "phone.release" }, makeT("da"), "da")).toBe("Frigiv telefonen: Plainphone slår sig selv fra på den");
  });

  it("keeps removing and releasing apart", () => {
    const t = makeT("en");
    expect(describeOp({ type: "phone.remove", dnsClientId: "x" }, t, "en")).not.toBe(describeOp({ type: "phone.release" }, t, "en"));
  });
});
