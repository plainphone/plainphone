// SPDX-License-Identifier: Apache-2.0
import { eq, gte, and, type AnyColumn } from "drizzle-orm";
import { z } from "zod";
import {
  contacts, dnsSettings, DNS_CATEGORIES, phoneApps, phoneSettings, phones, schedules, selfKeys,
  timeBonuses, timeLimits, users, FILTER_METHODS, LOCATION_MODES,
} from "../db/schema.js";
import { sha256 } from "../lib/crypto.js";
import { fullHome, homeInput, isSettingKey, settingBody } from "../lib/phone-settings.js";
import { domain, keyInput, packageName, phoneNumber, scheduleInput } from "../lib/validation.js";
import { limitInput, limitTarget, localDate } from "./limits.js";
import type { Ctx } from "./context.js";

export type MoveDb = Ctx["db"] | Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];
export type MovePhone = typeof phones.$inferSelect;

export function allowsServerMove(phone: Pick<MovePhone, "allowServerMove" | "profile">) {
  return phone.allowServerMove ?? phone.profile === "child";
}

const strings = z.array(z.string());
const setting = z.object({ mode: z.enum(["preset", "locked"]), value: z.union([z.string(), z.number()]).optional() });
// Every imported field goes through the same validators as the normal endpoints:
// the bundle signature only proves which server sent it, not that its values are sane.
export const portablePolicy = z.object({
  profile: z.enum(["child", "self"]),
  mode: z.enum(["strong", "light"]),
  /** How a light phone filters DNS. Part of the policy hash so both servers agree on it. */
  filterMethod: z.enum(FILTER_METHODS),
  timezone: z.string().max(64).refine((v) => {
    try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; }
  }),
  suggestDeviceContacts: z.boolean(),
  lightContactRestriction: z.boolean(),
  selfScheduleContacts: z.boolean().nullable(),
  allowServerMove: z.boolean(),
  locationMode: z.enum(LOCATION_MODES),
  locationAlwaysUntil: z.iso.datetime().nullable(),
  apps: z.array(z.object({
    packageName, label: z.string().max(200), allowed: z.boolean(), core: z.boolean(),
    explicitlyBlocked: z.boolean(), installed: z.boolean(), requested: z.boolean(),
  })).max(5000),
  contacts: z.array(z.object({ name: z.string().trim().min(1).max(60), number: phoneNumber })).max(1000),
  schedules: z.array(scheduleInput).max(200),
  limits: z.array(limitInput.extend({ packageName: limitTarget })).max(1000),
  bonuses: z.array(z.object({ packageName: limitTarget, day: z.iso.date(), minutes: z.int().min(1).max(1440) })).max(1000),
  dns: z.object({
    blockedCategories: z.array(z.enum(DNS_CATEGORIES)), allowDomains: z.array(domain).max(5000), blockDomains: z.array(domain).max(5000),
  }),
  settings: z.record(z.string(), setting).refine((v) =>
    Object.entries(v).every(([key, s]) => isSettingKey(key) && settingBody(key).safeParse(s).success)),
  home: homeInput,
  key: keyInput.and(z.object({ payUnlockCurrency: z.string().regex(/^[A-Z]{3}$/) })).nullable(),
});
type Policy = z.infer<typeof portablePolicy>;

export function policyHash(policy: Policy) {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]));
    }
    return value;
  }
  // Only current bonuses appear in the rules preview, where the phone compares
  // both servers. They age out independently of the portable policy.
  const { bonuses: _bonuses, ...policySettings } = policy;
  return sha256(JSON.stringify(canonical(policySettings)));
}

export async function readMovePolicy(db: MoveDb, phone: MovePhone, now: Date): Promise<Policy> {
  const byPhone = (table: { phoneId: AnyColumn }) => eq(table.phoneId, phone.id);
  const [apps, numbers, windows, limits, bonuses, [dns], [own], [key]] = await Promise.all([
    db.select().from(phoneApps).where(byPhone(phoneApps)).orderBy(phoneApps.packageName),
    db.select().from(contacts).where(byPhone(contacts)).orderBy(contacts.number),
    db.select().from(schedules).where(byPhone(schedules)).orderBy(schedules.createdAt, schedules.id),
    db.select().from(timeLimits).where(byPhone(timeLimits)).orderBy(timeLimits.packageName),
    db.select().from(timeBonuses).where(and(byPhone(timeBonuses), gte(timeBonuses.day, localDate(phone.timezone, now))))
      .orderBy(timeBonuses.day, timeBonuses.packageName, timeBonuses.minutes),
    db.select().from(dnsSettings).where(byPhone(dnsSettings)),
    db.select().from(phoneSettings).where(byPhone(phoneSettings)),
    db.select({ key: selfKeys, email: users.email }).from(selfKeys).leftJoin(users, eq(users.id, selfKeys.trustedUserId))
      .where(byPhone(selfKeys)),
  ]);
  return portablePolicy.parse({
    ...phone,
    allowServerMove: allowsServerMove(phone),
    locationAlwaysUntil: phone.locationAlwaysUntil?.toISOString() ?? null,
    apps, contacts: numbers, schedules: windows, limits, bonuses, dns,
    settings: own?.settings ?? {},
    home: fullHome(own?.home),
    key: key ? { ...key.key, trustedEmail: key.email ?? key.key.trustedEmail } : null,
  });
}

export async function writeMovePolicy(db: MoveDb, phoneId: string, policy: Policy, trustedUserId: string | null) {
  if (policy.apps.length) await db.insert(phoneApps).values(policy.apps.map((app) => ({ ...app, phoneId })));
  if (policy.contacts.length) await db.insert(contacts).values(policy.contacts.map((contact) => ({ ...contact, phoneId })));
  if (policy.schedules.length) {
    // Preserve ordering even when a bulk insert gives every row the same database timestamp.
    await db.insert(schedules).values(policy.schedules.map((schedule, i) => ({ ...schedule, phoneId, createdAt: new Date(i) })));
  }
  if (policy.limits.length) await db.insert(timeLimits).values(policy.limits.map((limit) => ({ ...limit, phoneId })));
  if (policy.bonuses.length) await db.insert(timeBonuses).values(policy.bonuses.map((bonus) => ({ ...bonus, phoneId })));
  await db.insert(dnsSettings).values({ ...policy.dns, phoneId });
  await db.insert(phoneSettings).values({ phoneId, settings: policy.settings, home: policy.home });
  if (policy.key) await db.insert(selfKeys).values({ ...policy.key, phoneId, trustedUserId });
}
