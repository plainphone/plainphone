// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { platformLine } from "./platform";

it("gives an iPhone a line for each rule its map does not fully support", () => {
  const phone = { platform: "ios" as const, capabilities: { contacts: "partial" as const, calmHome: "no" as const, apps: "yes" as const } };
  expect(platformLine(phone, "contacts")).toBe("platform.ios.contacts");
  expect(platformLine(phone, "home")).toBe("platform.ios.calmHome");
  expect(platformLine(phone, "apps")).toBeNull();
  // Rows without a capability, and missing map entries, say nothing rather than guess.
  expect(platformLine(phone, "time")).toBeNull();
  expect(platformLine(phone, "filter")).toBeNull();
});

it("leaves Android phones and old servers alone", () => {
  expect(platformLine({ platform: "android", capabilities: { contacts: "no" } }, "contacts")).toBeNull();
  expect(platformLine({}, "contacts")).toBeNull();
});
