// SPDX-License-Identifier: Apache-2.0
// The time zone picker in the Add phone flow: the browser's zone first, then the zones of the
// countries Plainphone speaks the language of, then every other zone, each as "City (UTC+1)".
import type { Language as Locale } from "@plainphone/i18n/phone-language";

/** Denmark, Sweden, Norway, Germany, Austria, Switzerland and the UK, with the city in each language. */
const COMMON: Record<string, Record<Locale, string>> = {
  "Europe/Copenhagen": { en: "Copenhagen", da: "København", sv: "Köpenhamn", nb: "København", de: "Kopenhagen" },
  "Europe/Stockholm": { en: "Stockholm", da: "Stockholm", sv: "Stockholm", nb: "Stockholm", de: "Stockholm" },
  "Europe/Oslo": { en: "Oslo", da: "Oslo", sv: "Oslo", nb: "Oslo", de: "Oslo" },
  "Europe/Berlin": { en: "Berlin", da: "Berlin", sv: "Berlin", nb: "Berlin", de: "Berlin" },
  "Europe/Vienna": { en: "Vienna", da: "Wien", sv: "Wien", nb: "Wien", de: "Wien" },
  "Europe/Zurich": { en: "Zurich", da: "Zürich", sv: "Zürich", nb: "Zürich", de: "Zürich" },
  "Europe/London": { en: "London", da: "London", sv: "London", nb: "London", de: "London" },
};

export interface ZoneOption {
  zone: string;
  label: string;
}

/** "UTC+1", "UTC-3:30" or "UTC" for the zone's offset at `at`. */
export function utcOffset(zone: string, at: Date): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    return part ? part.replace(/^GMT/, "UTC").replace(/^UTC[+-]0$/, "UTC") : "UTC";
  } catch {
    return "UTC";
  }
}

/** The city part of an IANA name: "America/Argentina/Buenos_Aires" is "Buenos Aires". */
function city(zone: string, locale: Locale): string {
  return COMMON[zone]?.[locale] ?? zone.slice(zone.lastIndexOf("/") + 1).replaceAll("_", " ");
}

export function zoneLabel(zone: string, locale: Locale, at: Date): string {
  if (zone === "UTC" || zone === "Etc/UTC") return "UTC";
  return `${city(zone, locale)} (${utcOffset(zone, at)})`;
}

/**
 * Two groups for the picker. `common`: the browser's zone, then the common zones. `rest`: all other
 * zones by city name. `selected` is always in one of them, even if this browser does not know it.
 */
export function timeZoneOptions(opts: {
  browserZone: string | undefined;
  selected: string;
  locale: Locale;
  at: Date;
  all?: readonly string[];
}): { common: ZoneOption[]; rest: ZoneOption[] } {
  const all = opts.all ?? Intl.supportedValuesOf("timeZone");
  const option = (zone: string) => ({ zone, label: zoneLabel(zone, opts.locale, opts.at) });
  const firstZones = [...new Set([opts.browserZone, ...Object.keys(COMMON)].filter((z): z is string => Boolean(z)))];
  const first = new Set(firstZones);
  const collator = new Intl.Collator(opts.locale);
  const rest = [...new Set(["UTC", ...all, opts.selected])]
    .filter((zone) => !first.has(zone))
    .map(option)
    .sort((a, b) => collator.compare(a.label, b.label));
  return { common: firstZones.map(option), rest };
}
