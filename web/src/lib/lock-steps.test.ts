// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { makeT } from "../i18n/translate";
import { lockStepLabel } from "./lock-steps";

describe("lock step labels", () => {
  it("translates strong and light mode steps", () => {
    const da = makeT("da");
    expect(lockStepLabel("restriction no_install_apps", da, "da")).toBe("begrænsning af appinstallation");
    expect(lockStepLabel("DNS filter (VPN)", da, "da")).toBe("webfilter i let tilstand");
    expect(lockStepLabel("setting screenTimeout", da, "da")).toBe("skærmens slukketid");
    expect(lockStepLabel("factory reset protection (2 account(s))", da, "da")).toBe("beskyttelse mod fabriksnulstilling");
  });

  it("uses sentence case for setting steps while preserving names and acronyms", () => {
    const en = makeT("en");
    expect(lockStepLabel("setting screenTimeout", en, "en")).toBe("screen timeout");
    expect(lockStepLabel("setting bluetooth", en, "en")).toBe("Bluetooth");
    expect(lockStepLabel("setting wifi", en, "en")).toBe("Wi-Fi");
    expect(lockStepLabel("setting nfc", en, "en")).toBe("NFC");
  });

  it("translates new hardening steps in both languages", () => {
    expect(lockStepLabel("restriction no_modify_accounts", makeT("da"), "da")).toBe("blokér ændringer af konti");
    expect(lockStepLabel("extra users and profiles: unknown", makeT("en"), "en")).toBe("remove extra users or profiles");
  });

  it("uses a generic label for unknown steps in both languages", () => {
    for (const locale of ["da", "en"] as const) {
      const t = makeT(locale);
      for (const step of ["future policy", "setting unknown", "__proto__"]) {
        expect(lockStepLabel(step, t, locale)).toBe(t("phone.lockUnknown"));
      }
    }
  });
});
