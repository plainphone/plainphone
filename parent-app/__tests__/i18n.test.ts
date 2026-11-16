// SPDX-License-Identifier: Apache-2.0
import { appDa } from "../src/i18n/app-da";
import { appEn } from "../src/i18n/app-en";
import { makeAppT } from "../src/i18n/I18n";
import { da } from "../src/shared/i18n/da";
import { en } from "../src/shared/i18n/en";

describe("app copy", () => {
  it("has every key in both languages, with no empty strings", () => {
    expect(Object.keys(appDa).sort()).toEqual(Object.keys(appEn).sort());
    for (const v of [...Object.values(appEn), ...Object.values(appDa)]) expect(v.trim()).not.toBe("");
  });
  it("uses no em dashes and keeps the same placeholders", () => {
    for (const k of Object.keys(appEn) as (keyof typeof appEn)[]) {
      expect(appEn[k]).not.toMatch(/—/);
      expect(appDa[k]).not.toMatch(/—/);
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(ph(appDa[k])).toEqual(ph(appEn[k]));
    }
  });
  it("does not shadow the shared PWA copy", () => {
    for (const k of Object.keys(appEn)) expect(k in en || k in da).toBe(false);
  });
  it("translates app and shared keys in Danish", () => {
    const t = makeAppT("da");
    expect(t("native.scanned", { code: "K7MP-4QXR" })).toBe("Koden K7MP-4QXR er scannet.");
    expect(t("login.title")).toBe(da["login.title"]);
  });
});
