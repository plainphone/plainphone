// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { da } from "./da";
import { en } from "./en";
import { makeT, pickLocale, translate } from "./translate";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("catalogues", () => {
  it("have the same keys", () => {
    expect(Object.keys(da).sort()).toEqual(Object.keys(en).sort());
  });

  it("use the same placeholders in both languages", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(da[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("have no empty strings and no em dashes", () => {
    for (const [lang, cat] of Object.entries({ en, da })) {
      for (const [key, value] of Object.entries(cat)) {
        expect(value.trim(), `${lang}:${key}`).not.toBe("");
        expect(value, `${lang}:${key}`).not.toContain("—");
      }
    }
  });

  it("write Danish with real letters", () => {
    expect(da["login.sentTitle"]).toBe("Tjek din indbakke");
    expect(da["phones.emptyBody"]).toContain("Vælg Tilføj");
    expect(Object.values(da).join(" ")).not.toMatch(/\b(ae|oe|aa)\b/);
  });
});

describe("translate", () => {
  it("fills placeholders and leaves unknown ones alone", () => {
    expect(translate(en, "phones.lastSeen", { when: "5 minutes ago" })).toBe("Last seen 5 minutes ago");
    expect(translate(en, "phones.lastSeen")).toBe("Last seen {when}");
    expect(makeT("da")("op.appShow", { app: "Instagram" })).toBe("Vis Instagram");
  });

  it("picks a locale from the saved value, then the browser", () => {
    expect(pickLocale("da", ["en-US"])).toBe("da");
    expect(pickLocale(null, ["da-DK", "en"])).toBe("da");
    expect(pickLocale(undefined, ["de-DE", "en-GB"])).toBe("en");
    expect(pickLocale("fr", ["fr-FR"])).toBe("en");
  });
});
