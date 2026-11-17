// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { lightSetupIntent, lightSetupLink } from "./light-setup";

const origin = "https://pp.example.org";
const token = "pp_e_3q2-7wEvR1q8aZ0sLx9Ywg";
const hash = "a".repeat(64);
const salt = "b".repeat(32);

describe("light setup handoff", () => {
  it("keeps setup credentials out of the HTTP request and builds an Android intent", () => {
    const url = new URL(lightSetupLink(origin, token, hash, salt, "da"));
    expect(url.origin + url.pathname + url.search).toBe(origin + "/install-phone");
    expect(lightSetupIntent(url)).toBe(
      `intent://setup?token=${token}&pinHash=${hash}&pinSalt=${salt}&server=https%3A%2F%2Fpp.example.org#Intent;scheme=plainphone;package=org.plainphone.app;end`,
    );
  });

  it("refuses to open Plainphone without all three setup credentials", () => {
    expect(lightSetupIntent(new URL(origin))).toBeNull();
    expect(lightSetupIntent(new URL(lightSetupLink(origin, token, hash, "", "da")))).toBeNull();
  });
});
