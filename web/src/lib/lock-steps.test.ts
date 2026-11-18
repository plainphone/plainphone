// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { makeT } from "../i18n/translate";
import { lockStepLabel } from "./lock-steps";

describe("lock step labels", () => {
  it("translates strong and light mode steps", () => {
    const da = makeT("da");
    expect(lockStepLabel("restriction no_install_apps", da)).toBe("Begrænsning af appinstallation");
    expect(lockStepLabel("DNS filter (VPN)", da)).toBe("Webfilter i let tilstand");
    expect(lockStepLabel("setting screenTimeout", da)).toBe("Skærmens slukketid");
    expect(lockStepLabel("factory reset protection (2 account(s))", da)).toBe("Beskyttelse mod fabriksnulstilling");
  });

  it("uses a generic label for unknown steps in both languages", () => {
    for (const locale of ["da", "en"] as const) {
      const t = makeT(locale);
      for (const step of ["future policy", "setting unknown", "__proto__"]) {
        expect(lockStepLabel(step, t)).toBe(t("phone.lockUnknown"));
      }
    }
  });
});
