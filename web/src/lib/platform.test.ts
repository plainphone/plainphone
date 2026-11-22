// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { platformLine, ruleRowUnavailable, unsupportedOnIphone } from "@plainphone/shared/platform";

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

it("explains the partial more-time and ring support on an iPhone", () => {
  const phone = { platform: "ios" as const, capabilities: { moreTime: "partial" as const, ring: "partial" as const, bedtimeSilence: "yes" as const } };
  expect(platformLine(phone, "time")).toBe("platform.ios.moreTime");
  expect(platformLine(phone, "location")).toBe("platform.ios.ring");
  expect(platformLine(phone, "schedules")).toBeNull();
});

it("turns a rule an iPhone cannot do at all into text, and only on an iPhone", () => {
  const iphone = { platform: "ios" as const, capabilities: { calmHome: "no" as const, contacts: "partial" as const, phoneSettings: "no" as const } };
  expect(ruleRowUnavailable(iphone, "home")).toBe(true);
  expect(ruleRowUnavailable(iphone, "settings")).toBe(true);
  // Partial support keeps the link and its line.
  expect(ruleRowUnavailable(iphone, "contacts")).toBe(false);
  // Unknown rows and missing map entries keep the link.
  expect(ruleRowUnavailable(iphone, "time")).toBe(false);
  expect(ruleRowUnavailable({ platform: "android", capabilities: { calmHome: "no" } }, "home")).toBe(false);
  expect(ruleRowUnavailable({}, "home")).toBe(false);
});

it("reads unsupported features from the map", () => {
  const iphone = { platform: "ios" as const, capabilities: { systemLanguage: "no" as const, sos: "yes" as const } };
  expect(unsupportedOnIphone(iphone, "systemLanguage")).toBe(true);
  expect(unsupportedOnIphone(iphone, "sos")).toBe(false);
  expect(unsupportedOnIphone({ platform: "android", capabilities: { systemLanguage: "no" } }, "systemLanguage")).toBe(false);
});
