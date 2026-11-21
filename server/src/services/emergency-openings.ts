// SPDX-License-Identifier: Apache-2.0
//
// Limited emergency openings on a Self phone (docs/emergency-openings.md). The owner turns them
// on and sets a monthly allowance (through the key, because both loosen). The phone counts and
// enforces the allowance itself, offline, and reports each use. The server never refuses a
// report: it records it, and tells the trusted person.

import { RateLimiter } from "../lib/http.js";
import { errorSummary } from "../lib/log.js";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { emergencyOpenings, householdMembers, phoneApps, phones, selfKeys } from "../db/schema.js";
import { DEFAULT_EMERGENCY_ALLOWANCE, EMERGENCY_MINUTES, MAX_EMERGENCY_ALLOWANCE } from "../lib/self-level.js";
import { localTime } from "../lib/zoned-time.js";
import { packageName } from "../lib/validation.js";
import type { Ctx } from "./context.js";
import { notifyUsers } from "./notifications.js";

type Phone = typeof phones.$inferSelect;
type Db = Ctx["db"];

/** How much history the dashboard shows. */
const HISTORY_DAYS = 90;
const HISTORY_LIMIT = 100;

/** YYYY-MM at an instant, on the wall clock of the phone's time zone. */
export function monthKey(at: Date, timeZone: string): string {
  const t = localTime(at, timeZone);
  return `${t.year}-${String(t.month).padStart(2, "0")}`;
}

/** The input of `PUT /phones/{pid}/emergency-openings`. */
export const emergencyInput = z.object({
  enabled: z.boolean(),
  allowance: z.number().int().min(1).max(MAX_EMERGENCY_ALLOWANCE),
});
export type EmergencyInput = z.infer<typeof emergencyInput>;

/** What the phone reports about one opening it has already used. */
export const openingReport = z.object({
  id: z.uuid(),
  packageName,
  openedAt: z.iso.datetime({ offset: true }),
  minutes: z.number().int().min(1).max(24 * 60).default(EMERGENCY_MINUTES),
});

export async function usedThisMonth(db: Db, phone: Pick<Phone, "id" | "timezone">, now: Date): Promise<{ month: string; count: number }> {
  const month = monthKey(now, phone.timezone);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(emergencyOpenings)
    .where(and(eq(emergencyOpenings.phoneId, phone.id), eq(emergencyOpenings.month, month)));
  return { month, count: row?.n ?? 0 };
}

/** The settings and this month's use, as the dashboard, the parent app and the phone read them. */
export async function emergencyState(db: Db, phone: Pick<Phone, "id" | "timezone">, now: Date) {
  const [key] = await db.select().from(selfKeys).where(eq(selfKeys.phoneId, phone.id));
  const used = await usedThisMonth(db, phone, now);
  return {
    enabled: key?.emergencyEnabled ?? false,
    allowance: key?.emergencyAllowance ?? DEFAULT_EMERGENCY_ALLOWANCE,
    minutes: EMERGENCY_MINUTES,
    used,
  };
}

/** The `selfEmergency` block of the rules document; null for a phone that is not a Self phone. */
export async function emergencyRules(ctx: Ctx, phone: Phone) {
  if (phone.profile !== "self") return null;
  return emergencyState(ctx.db, phone, ctx.now());
}

/** The openings of the last 90 days, newest first, with the app's name when the server knows it. */
export async function listOpenings(db: Db, phone: Pick<Phone, "id" | "timezone">, now: Date) {
  const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
  const rows = await db
    .select({
      id: emergencyOpenings.id,
      packageName: emergencyOpenings.packageName,
      label: phoneApps.label,
      openedAt: emergencyOpenings.openedAt,
      minutes: emergencyOpenings.minutes,
    })
    .from(emergencyOpenings)
    .leftJoin(phoneApps, and(eq(phoneApps.phoneId, emergencyOpenings.phoneId), eq(phoneApps.packageName, emergencyOpenings.packageName)))
    .where(and(eq(emergencyOpenings.phoneId, phone.id), gte(emergencyOpenings.openedAt, since)))
    .orderBy(desc(emergencyOpenings.openedAt))
    .limit(HISTORY_LIMIT);
  return rows.map((r) => ({
    id: r.id,
    packageName: r.packageName,
    appLabel: r.label ?? null,
    openedAt: r.openedAt.toISOString(),
    minutes: r.minutes,
  }));
}

/**
 * Records an opening the phone already used. Idempotent on the phone's id. The phone is the
 * authority, so nothing is refused: not a switch that is off now, not an allowance that is spent.
 * The trusted person is told once, when the row is new.
 */
export async function recordOpening(ctx: Ctx, phone: Phone, report: z.infer<typeof openingReport>): Promise<{ recorded: boolean }> {
  const now = ctx.now();
  const claimed = new Date(report.openedAt);
  // A clock that is wrong by more than a day is not evidence of when it happened.
  const openedAt = Math.abs(claimed.getTime() - now.getTime()) > 86_400_000 && claimed.getTime() > now.getTime() ? now : claimed;
  const inserted = await ctx.db
    .insert(emergencyOpenings)
    .values({
      id: report.id,
      phoneId: phone.id,
      packageName: report.packageName,
      openedAt,
      minutes: report.minutes,
      month: monthKey(openedAt, phone.timezone),
    })
    .onConflictDoNothing()
    .returning({ id: emergencyOpenings.id });
  if (inserted.length === 0) return { recorded: false };
  await tellTrustedPerson(ctx, phone, report.packageName, openedAt, report.minutes);
  return { recorded: true };
}

/** Reports are always recorded; past this many an hour the trusted person is no longer pinged for each one. */
const NOTICES_PER_HOUR = 20;
const noticeLimiter = new RateLimiter(NOTICES_PER_HOUR, 3_600_000);

async function tellTrustedPerson(ctx: Ctx, phone: Phone, pkg: string, openedAt: Date, minutes: number) {
  if (!noticeLimiter.take(phone.id, ctx.now().getTime())) return;
  try {
    const [key] = await ctx.db.select().from(selfKeys).where(eq(selfKeys.phoneId, phone.id));
    const helper = key?.keyType === "trusted" ? key.trustedUserId : null;
    if (!helper) return;
    // A helper who is in the phone's own household is not a separate person to tell.
    const [member] = await ctx.db.select({ userId: householdMembers.userId }).from(householdMembers)
      .where(and(eq(householdMembers.householdId, phone.householdId), eq(householdMembers.userId, helper)));
    if (member) return;
    const [app] = await ctx.db.select({ label: phoneApps.label }).from(phoneApps)
      .where(and(eq(phoneApps.phoneId, phone.id), eq(phoneApps.packageName, pkg)));
    const used = await usedThisMonth(ctx.db, phone, openedAt);
    await notifyUsers(ctx, [helper], {
      type: "emergencyOpening",
      phoneId: phone.id,
      phoneName: phone.name,
      appName: app?.label ?? null,
      minutes,
      used: used.count,
      allowance: key!.emergencyAllowance,
    }, { respectMuteFor: phone.id });
  } catch (err) {
    // A failed push never fails the report: the phone has already opened the app.
    console.error(`could not tell the trusted person about an emergency opening: ${errorSummary(err)}`);
  }
}
