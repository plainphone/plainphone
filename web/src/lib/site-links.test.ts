// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { isHostedService, privacyUrl, termsUrl } from "./site-links";

it("knows the hosted service", () => {
  expect(isHostedService("https://app.plainphone.org")).toBe(true);
  expect(isHostedService("https://plainphone.example.com")).toBe(false);
  expect(isHostedService("http://localhost:5173")).toBe(false);
});

it("builds the website addresses in the dashboard language", () => {
  expect(termsUrl("en")).toBe("https://plainphone.org/terms/");
  expect(termsUrl("de")).toBe("https://plainphone.org/de/terms/");
  expect(privacyUrl("sv")).toBe("https://plainphone.org/sv/privacy/");
});
