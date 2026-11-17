// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import androidIntent from "../../test-fixtures/light-setup-intent.txt?raw";
import { hashPin } from "./provisioning";
import { lightSetupIntent, lightSetupLink } from "./light-setup";

const origin = "https://pp.example.org";
const token = "pp_e_3q2-7wEvR1q8aZ0sLx9Ywg";
const hash = "a".repeat(64);
const salt = "b".repeat(32);

describe("light setup handoff", () => {
  it("keeps credentials out of HTTP and emits the intent Android resolves and imports", async () => {
    const pinHash = await hashPin("123456", salt);
    const url = new URL(lightSetupLink(origin, token, pinHash, salt, "da"));
    expect(url.origin + url.pathname + url.search).toBe(origin + "/install-phone");
    expect(lightSetupIntent(url)).toBe(androidIntent.trim());
  });

  it("refuses to open Plainphone without all three setup credentials", () => {
    expect(lightSetupIntent(new URL(origin))).toBeNull();
    expect(lightSetupIntent(new URL(lightSetupLink(origin, token, hash, "", "da")))).toBeNull();
  });
});
