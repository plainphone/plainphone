// SPDX-License-Identifier: Apache-2.0
//
// Hermes, the engine in the native builds, has Intl.DateTimeFormat, NumberFormat and Collator,
// but no Intl.RelativeTimeFormat or Intl.ListFormat, and with style "unit" its NumberFormat
// converts the unit itself (250 m came out as "0,25 km", 1.25 km as "0.777mi" on an iOS 27 simulator).
// Jest runs on Node, which has all of it, so these tests take the missing parts away.
import { formatAccountTypes, formatList, formatMeters, formatRelative, intlLocale } from "../src/shared/lib/format";
import { languages } from "@plainphone/i18n/phone-language";

const RealNf = Intl.NumberFormat;
const saved = (["RelativeTimeFormat", "ListFormat", "NumberFormat"] as const).map(
  (name) => [name, Object.getOwnPropertyDescriptor(Intl, name)!] as const,
);

function hideMissingHermesApis() {
  // @ts-expect-error simulating Hermes
  delete Intl.RelativeTimeFormat;
  // @ts-expect-error simulating Hermes
  delete Intl.ListFormat;
}

afterEach(() => {
  for (const [name, descriptor] of saved) Object.defineProperty(Intl, name, descriptor);
});

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const at = (offsetSec: number) => new Date(NOW + offsetSec * 1000).toISOString();

// Every branch formatRelative can reach, with the boundaries between them.
const OFFSETS = [
  0, -1, 29, -59, 59, -60, 60, -89, -90, 90, -1799, -3599, 3599, -3600, 3600, -5400, -86_399, 86_399,
  -86_400, 86_400, -129_599, -129_600, 129_600, -172_800, 172_800, -259_200, 259_200, -86_400 * 1500, 86_400 * 1500,
];

describe("formatRelative without Intl.RelativeTimeFormat", () => {
  it.each(languages)("matches the native output in %s", (locale) => {
    const expected = OFFSETS.map((s) => formatRelative(at(s), NOW, locale));
    hideMissingHermesApis();
    const actual = OFFSETS.map((s) => formatRelative(at(s), NOW, locale));
    expect(actual).toEqual(expected);
  });

  it("does not throw on the phone list", () => {
    hideMissingHermesApis();
    expect(formatRelative(at(-300), NOW, "da")).toBe("for 5 minutter siden");
    expect(formatRelative(at(-86_400), NOW, "en")).toBe("yesterday");
  });
});

describe("formatList without Intl.ListFormat", () => {
  const lists = [[], ["Ella"], ["Ella", "Noah"], ["Ella", "Noah", "Ida"], ["a", "b", "c", "d"]];

  it.each(languages)("matches the native output in %s", (locale) => {
    const expected = lists.map((l) => formatList(l, locale));
    hideMissingHermesApis();
    expect(lists.map((l) => formatList(l, locale))).toEqual(expected);
  });

  it("keeps formatAccountTypes working", () => {
    hideMissingHermesApis();
    expect(formatAccountTypes(["com.google", "com.oneplus.cloud", "x"], "da")).toBe("Google, OnePlus og Anden konto");
  });
});

describe("formatMeters", () => {
  const distances = [0, 8, 250.4, 999, 1000, 1260, 12_340, 154_000];

  it.each(languages)("matches the native unit output in %s", (locale) => {
    const expected = distances.map((m) =>
      new RealNf(intlLocale(locale), {
        style: "unit",
        unit: m >= 1000 ? "kilometer" : "meter",
        maximumFractionDigits: m >= 1000 ? 1 : 0,
      }).format(m >= 1000 ? m / 1000 : m),
    );
    expect(distances.map((m) => formatMeters(m, locale))).toEqual(expected);
  });

  it('does not depend on NumberFormat style "unit"', () => {
    const styles: unknown[] = [];
    const Spy = function (this: unknown, locales?: string | string[], options?: Intl.NumberFormatOptions) {
      styles.push(options?.style);
      return new RealNf(locales, options);
    } as unknown as typeof Intl.NumberFormat;
    Object.defineProperty(Intl, "NumberFormat", { ...saved[2][1], value: Spy });
    formatMeters(250, "da");
    formatMeters(1260, "en");
    expect(styles.length).toBeGreaterThan(0);
    expect(styles).not.toContain("unit");
  });
});
