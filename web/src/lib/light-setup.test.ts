// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import androidIntent from "../../test-fixtures/light-setup-intent.txt?raw";
import { lightSetupIntent, lightSetupLink } from "./light-setup";

const origin = "https://pp.example.org";
const token = "pp_e_3q2-7wEvR1q8aZ0sLx9Ywg";
const component = "org.plainphone.app/.PlainphoneAdminReceiver";

describe("light setup handoff", () => {
  it("emits a PIN-free link and the intent Android resolves and imports", () => {
    const url = new URL(lightSetupLink(origin, token, component, "da"));
    expect(url.origin + url.pathname + url.search).toBe(origin + "/install-phone");
    expect(Object.fromEntries(new URLSearchParams(url.hash.slice(1)))).toEqual({
      token, package: "org.plainphone.app", lang: "da",
    });
    expect(lightSetupIntent(url)).toBe(androidIntent.trim());
  });

  it("carries a self-hosted origin and port through the dashboard link into Android", () => {
    const custom = "https://my-plainphone.example.org:8443";
    const link = new URL(lightSetupLink(custom, token, component, "en"));
    expect(link.origin).toBe(custom);
    const intent = lightSetupIntent(link);
    expect(intent).toContain(`&server=${encodeURIComponent(custom)}#Intent;`);
    expect(intent).toContain(encodeURIComponent(custom + "/download/android"));
  });

  it("derives the package from the configured admin component", () => {
    const url = new URL(lightSetupLink(origin, token, "org.example.phone/.Admin", "en"));
    expect(lightSetupIntent(url)).toContain(";package=org.example.phone;");
  });

  it("rejects malformed links", () => {
    expect(lightSetupIntent(new URL(origin))).toBeNull();
    expect(lightSetupIntent(new URL(lightSetupLink(origin, "bad-token", component, "da")))).toBeNull();
    expect(lightSetupIntent(new URL(lightSetupLink(origin, token, "invalid;end", "da")))).toBeNull();
  });
});
