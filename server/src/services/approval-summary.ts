// SPDX-License-Identifier: Apache-2.0
import { and, eq } from "drizzle-orm";
import { phoneApps, phoneSettings, schedules, selfKeys, timeLimits } from "../db/schema.js";
import type { SettingState } from "../lib/phone-settings.js";
import type { ScheduleInput } from "../lib/validation.js";
import type { Op } from "./changes.js";
import type { Ctx } from "./context.js";
import type { Limit } from "./limits.js";

type Locale = "en" | "da";
type Db = Ctx["db"] | Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];
const copy = (en: string, da: string) => ({ en, da });
const localized = (format: (locale: Locale) => string) => copy(format("en"), format("da"));
const clock = (minutes: number) => [Math.floor(minutes / 60), minutes % 60].map((n) => String(n).padStart(2, "0")).join(":");
const safe = (value: string) => value.replace(/[\p{Cc}\p{Bidi_Control}]/gu, " ").trim();
const dayName = (day: number, locale: Locale) => new Intl.DateTimeFormat(locale, {
  weekday: "short", timeZone: "UTC",
}).format(new Date(Date.UTC(2024, 0, day))); // January 1 was Monday.

function limitText(limit: Limit | null, locale: Locale) {
  if (!limit) return locale === "da" ? "ingen grænse" : "no limit";
  const overrides = Object.entries(limit.days).map(([day, value]) => `${dayName(Number(day), locale)} ${value} min`);
  const daily = `${limit.minutes} min ${locale === "da" ? "om dagen" : "a day"}`;
  return overrides.length ? `${daily} (${overrides.join(", ")})` : daily;
}

function scheduleText(schedule: ScheduleInput, locale: Locale, label: (pkg: string) => string) {
  const days = [...schedule.days].sort((a, b) => a - b).map((day) => dayName(day, locale)).join(", ");
  const time = `${clock(schedule.startMinute)}–${clock(schedule.endMinute)}`;
  const apps = schedule.allowedPackages.map(label).join(", ");
  return apps ? `${time} (${days}), ${locale === "da" ? "tillad også" : "also allow"} ${apps}` : `${time} (${days})`;
}

const settingNames: Record<Extract<Op, { type: "setting.set" }>["key"], ReturnType<typeof copy>> = {
  bluetooth: copy("Bluetooth", "Bluetooth"), wifi: copy("Wi-Fi", "Wi-fi"),
  mobileNetworks: copy("Mobile networks", "Mobilnetværk"), roaming: copy("Roaming", "Roaming"),
  location: copy("Location", "Placering"), camera: copy("Camera", "Kamera"),
  screenCapture: copy("Screenshots", "Skærmbilleder"), screenTimeout: copy("Screen timeout", "Skærmtimeout"),
  brightness: copy("Brightness", "Lysstyrke"), volume: copy("Volume", "Lydstyrke"),
  wallpaper: copy("Wallpaper", "Baggrund"), language: copy("Language", "Sprog"),
  tethering: copy("Internet sharing", "Internetdeling"), nfc: copy("NFC", "NFC"),
  airplaneMode: copy("Airplane mode", "Flytilstand"),
};

function settingText(key: keyof typeof settingNames, setting: SettingState | undefined, locale: Locale) {
  const mode = {
    free: copy("unlocked", "ulåst"),
    locked: copy("locked", "låst"),
    preset: copy("preset, unlocked", "forvalgt, ulåst"),
  }[setting?.mode ?? "free"][locale];
  const value = setting?.value;
  if (value === undefined) return mode;
  const names: Record<string, ReturnType<typeof copy>> = {
    on: copy("on", "til"), off: copy("off", "fra"), auto: copy("automatic", "automatisk"),
    noNewDevices: copy("no new devices", "ingen nye enheder"), muted: copy("muted", "lydløs"),
    plainphone: copy("Plainphone", "Plainphone"),
  };
  const text = typeof value === "number" ? `${value}${key === "screenTimeout" ? " s" : "%"}` : names[value]?.[locale];
  return text ? `${mode} (${text})` : mode;
}

/** Describes the current rule and the requested change, without returning the stored op. */
export async function approvalSummary(db: Db, phoneId: string, op: Op, appLabel: string | null) {
  const app = safe(appLabel ?? ("packageName" in op ? op.packageName : "")) || ("packageName" in op ? op.packageName : "");
  switch (op.type) {
    case "app.set":
      return op.allowed ? copy(`Allow ${app}`, `Tillad ${app}`) : copy(`Hide ${app}`, `Skjul ${app}`);
    case "timeLimit.set": {
      const [current] = await db.select().from(timeLimits)
        .where(and(eq(timeLimits.phoneId, phoneId), eq(timeLimits.packageName, op.packageName)));
      const target = op.packageName === "*" ? copy("All apps", "Alle apps") : copy(app, app);
      const before = current && Object.keys(current.days).length === 0 && op.limit && Object.keys(op.limit.days).length === 0
        ? String(current.minutes) : null;
      return localized((locale) => `${target[locale]}: ${before ?? limitText(current ?? null, locale)} → ${limitText(op.limit, locale)}`);
    }
    case "timeLimit.bonus": {
      const target = op.packageName === "*" ? copy("All apps", "Alle apps") : copy(app, app);
      return copy(`${target.en}: add ${op.minutes} min on ${op.date}`, `${target.da}: tilføj ${op.minutes} min den ${op.date}`);
    }
    case "schedule.create":
    case "schedule.update":
    case "schedule.delete": {
      const [previous] = "scheduleId" in op ? await db.select().from(schedules)
        .where(and(eq(schedules.phoneId, phoneId), eq(schedules.id, op.scheduleId))) : [];
      const next = "schedule" in op ? op.schedule : undefined;
      const labels = previous?.allowedPackages.length || next?.allowedPackages.length
        ? await db.select({ pkg: phoneApps.packageName, label: phoneApps.label })
          .from(phoneApps).where(eq(phoneApps.phoneId, phoneId)) : [];
      const label = (pkg: string) => safe(labels.find((entry) => entry.pkg === pkg)?.label ?? pkg);
      const titles = { bedtime: copy("Bedtime", "Sengetid"), school: copy("School time", "Skoletid") };
      const kind = (next ?? previous)?.kind;
      const title = kind ? titles[kind] : copy("Schedule", "Tidsplan");
      const off = copy("off", "fra");
      const changesKind = previous && next && previous.kind !== next.kind;
      return localized((locale) => {
        const describe = (schedule: ScheduleInput | undefined) => {
          if (!schedule) return off[locale];
          const window = scheduleText(schedule, locale, label);
          return changesKind ? `${titles[schedule.kind][locale]} ${window}` : window;
        };
        return `${(changesKind ? copy("Schedule", "Tidsplan") : title)[locale]}: ${describe(previous)} → ${describe(next)}`;
      });
    }
    case "dns.allowDomain":
      return op.present ? copy(`Allow ${safe(op.domain)}`, `Tillad ${safe(op.domain)}`) : copy(`Stop allowing ${safe(op.domain)}`, `Fjern tilladelsen til ${safe(op.domain)}`);
    case "dns.blockDomain":
      return op.present ? copy(`Block ${safe(op.domain)}`, `Blokér ${safe(op.domain)}`) : copy(`Stop blocking ${safe(op.domain)}`, `Fjern blokeringen af ${safe(op.domain)}`);
    case "dns.category": {
      const categories: Record<string, ReturnType<typeof copy>> = {
        adult: copy("adult content", "voksenindhold"), gambling: copy("gambling", "pengespil"),
        social: copy("social media", "sociale medier"), games: copy("games", "spil"),
        video: copy("video", "video"),
        dating: copy("dating", "dating"),
      };
      const category = categories[op.category] ?? copy(op.category, op.category);
      return op.blocked ? copy(`Block ${category.en}`, `Blokér ${category.da}`) : copy(`Allow ${category.en}`, `Tillad ${category.da}`);
    }
    // Contact values stay private to the phone owner.
    case "contact.add": return copy("Add a trusted contact", "Tilføj en betroet kontakt");
    case "contact.remove": return copy("Remove a trusted contact", "Fjern en betroet kontakt");
    case "setting.set": {
      const [current] = await db.select({ settings: phoneSettings.settings }).from(phoneSettings).where(eq(phoneSettings.phoneId, phoneId));
      return localized((locale) => `${settingNames[op.key][locale]}: ${settingText(op.key, current?.settings[op.key], locale)} → ${settingText(op.key, op.setting, locale)}`);
    }
    case "key.set": {
      const [current] = await db.select().from(selfKeys).where(eq(selfKeys.phoneId, phoneId));
      const next = op.key;
      return localized((locale) => {
        const hours = (value: number) => `${value} ${locale === "da" ? "timer" : "h"}`;
        const trusted = copy("trusted person", "betroet person");
        const newHelper = copy("new trusted person", "ny betroet person");
        const fallback = copy("wait if unavailable", "vent hvis personen er utilgængelig");
        const pay = copy("pay to unlock", "betal for at låse op");
        const describe = (rule: Pick<typeof next, "keyType" | "delayHours" | "payUnlockEnabled" | "payUnlockAmount">, newPerson = false) => {
          const wait = hours(rule.delayHours);
          const person = newPerson ? newHelper[locale] : trusted[locale];
          const key = rule.keyType === "trusted" ? `${person} (${fallback[locale]}: ${wait})` : wait;
          if (!rule.payUnlockEnabled) return key;
          const amount = new Intl.NumberFormat(locale, { style: "currency", currency: current?.payUnlockCurrency ?? "DKK" })
            .format(rule.payUnlockAmount / 100);
          return `${key}, ${pay[locale]}: ${amount}`;
        };
        const changedHelper = next.keyType === "trusted" &&
          (current?.keyType !== "trusted" || next.qrInvite || next.trustedEmail !== current.trustedEmail);
        const key = copy("Key", "Nøgle");
        const from = current ? describe(current) : copy("none", "ingen")[locale];
        return `${key[locale]}: ${from} → ${describe(next, changedHelper)}`;
      });
    }
    case "catalog.add": return copy(`Add ${safe(op.label)} to the app list`, `Tilføj ${safe(op.label)} til applisten`);
    case "catalog.remove": return copy(`Remove ${app} from the app list`, `Fjern ${app} fra applisten`);
    case "phone.release": return copy("Release this phone", "Frigiv denne telefon");
    case "phone.remove": return copy("Remove this phone from Plainphone", "Fjern denne telefon fra Plainphone");
    case "home.set": return copy("Change the home screen", "Ændr hjemmeskærmen");
  }
}
