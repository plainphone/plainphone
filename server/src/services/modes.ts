// SPDX-License-Identifier: Apache-2.0
//
// Modes on one weekly schedule, and the contact groups they open (docs/modes.md). Only on
// Child phones. With modes off nothing here reaches the phone: the rules document keeps the
// school time and bedtime table.

import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  CONTACT_GROUPS,
  type ContactGroup,
  MODE_PRESETS,
  modeSlots,
  modes,
  phones,
  schedules,
} from "../db/schema.js";
import { localTime } from "../lib/zoned-time.js";
import { packageName } from "../lib/validation.js";
import { coverage } from "./changes.js";
import type { Ctx } from "./context.js";
import { nextRulesRevision } from "./phones.js";
import { recordSummaryEvent } from "./summary-record.js";

type Phone = typeof phones.$inferSelect;
type Mode = typeof modes.$inferSelect;
type Slot = typeof modeSlots.$inferSelect;
type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

export class ModeError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

const groups = z
  .array(z.enum(CONTACT_GROUPS))
  .max(3)
  .transform((g) => CONTACT_GROUPS.filter((x) => g.includes(x)));

export const modeInput = z.strictObject({
  preset: z.enum(MODE_PRESETS),
  name: z.string().trim().min(1).max(30).nullable().default(null),
  allApps: z.boolean(),
  allowedPackages: z.array(packageName).max(50).default([]).transform((p) => [...new Set(p)].sort()),
  contactGroups: groups,
  quiet: z.boolean().default(false),
});
export type ModeInput = z.infer<typeof modeInput>;

/** The default mode only takes a new name: its rules are the phone's normal rules. */
export const defaultModeInput = z.strictObject({ name: z.string().trim().min(1).max(30).nullable() });

export const slotInput = z
  .strictObject({
    modeId: z.uuid(),
    days: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .transform((d) => [...new Set(d)].sort()),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(0).max(1439),
  })
  .refine((s) => s.startMinute !== s.endMinute, { message: "start and end must differ" });
export const scheduleInput = z.strictObject({ slots: z.array(slotInput).max(100) });
export type SlotInput = z.infer<typeof slotInput>;

export const contactGroupInput = z.strictObject({ group: z.enum(CONTACT_GROUPS) });

/** True when two slots share a minute of the week. */
export function overlaps(slots: Pick<SlotInput, "days" | "startMinute" | "endMinute">[]): boolean {
  const week = new Uint8Array(7 * 1440);
  for (const s of slots) {
    const c = coverage(s);
    for (let i = 0; i < week.length; i++) {
      if (!c[i]) continue;
      if (week[i]) return true;
      week[i] = 1;
    }
  }
  return false;
}

export async function loadModes(db: Ctx["db"] | Tx, phoneId: string) {
  const [modeRows, slotRows] = await Promise.all([
    db.select().from(modes).where(eq(modes.phoneId, phoneId)).orderBy(asc(modes.createdAt), asc(modes.id)),
    db.select().from(modeSlots).where(eq(modeSlots.phoneId, phoneId)).orderBy(asc(modeSlots.createdAt), asc(modeSlots.id)),
  ]);
  return { modes: modeRows, slots: slotRows };
}

const ALL_GROUPS: ContactGroup[] = [...CONTACT_GROUPS];

/**
 * The first time modes are turned on: Free, plus one mode per kind of window the phone already has,
 * with every group open, so nothing changes until the parent edits something.
 */
async function seedModes(tx: Tx, phoneId: string) {
  const windows = await tx.select().from(schedules).where(eq(schedules.phoneId, phoneId))
    .orderBy(asc(schedules.createdAt), asc(schedules.id));
  const at = (i: number) => new Date(Date.UTC(2000, 0, 1) + i * 1000);
  let order = 0;
  const insert = async (values: Omit<typeof modes.$inferInsert, "phoneId">) => {
    const [row] = await tx.insert(modes).values({ ...values, phoneId, createdAt: at(order++) }).returning();
    return row!;
  };
  await insert({ preset: "free", allApps: true, contactGroups: ALL_GROUPS, isDefault: true });
  const byKey = new Map<string, Mode>();
  for (const w of windows) {
    const packages = [...w.allowedPackages].sort();
    const key = `${w.kind}|${packages.join(",")}`;
    let mode = byKey.get(key);
    if (!mode) {
      const bedtime = w.kind === "bedtime";
      mode = await insert({
        preset: bedtime ? "night" : "school", allApps: false, allowedPackages: packages, contactGroups: ALL_GROUPS, quiet: bedtime,
      });
      byKey.set(key, mode);
    }
    await tx.insert(modeSlots).values({
      phoneId, modeId: mode.id, days: w.days, startMinute: w.startMinute, endMinute: w.endMinute, createdAt: at(order++),
    });
  }
  const kinds = new Set(windows.map((w) => w.kind));
  if (!kinds.has("school")) await insert({ preset: "school", allApps: false, contactGroups: ["family"] });
  await insert({ preset: "homework", allApps: false, contactGroups: ["family", "friends"] });
  if (!kinds.has("bedtime")) await insert({ preset: "night", allApps: false, contactGroups: ["family"], quiet: true });
}

async function touch(tx: Tx, phone: Phone, now: Date) {
  const [fresh] = await tx.update(phones).set(nextRulesRevision()).where(eq(phones.id, phone.id))
    .returning({ weeklySummaryEnabled: phones.weeklySummaryEnabled });
  if (fresh?.weeklySummaryEnabled) await recordSummaryEvent(tx, phone.id, "change", now, "schedules");
}

/** Turns modes on or off. Turning them on the first time makes them from the phone's windows. */
export async function setModesEnabled(ctx: Ctx, phone: Phone, enabled: boolean) {
  if (phone.profile !== "child") throw new ModeError(409, "modes are only for child phones");
  await ctx.db.transaction(async (tx) => {
    const [current] = await tx.select().from(phones).where(eq(phones.id, phone.id)).for("update");
    if (!current || current.modesEnabled === enabled) return;
    if (enabled) {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(modes).where(eq(modes.phoneId, phone.id)) as [{ n: number }];
      if (n === 0) await seedModes(tx, phone.id);
    }
    await tx.update(phones).set({ modesEnabled: enabled }).where(eq(phones.id, phone.id));
    await touch(tx, phone, ctx.now());
  });
}

export async function createMode(ctx: Ctx, phone: Phone, input: ModeInput) {
  return ctx.db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(modes).where(eq(modes.phoneId, phone.id)) as [{ n: number }];
    if (n >= 20) throw new ModeError(400, "too many modes");
    const [row] = await tx.insert(modes).values({ ...input, phoneId: phone.id, createdAt: ctx.now() }).returning();
    await touch(tx, phone, ctx.now());
    return row!;
  });
}

export async function updateMode(ctx: Ctx, phone: Phone, modeId: string, raw: unknown) {
  return ctx.db.transaction(async (tx) => {
    const [mode] = await tx.select().from(modes).where(and(eq(modes.id, modeId), eq(modes.phoneId, phone.id))).for("update");
    if (!mode) throw new ModeError(404, "mode not found");
    const parsed = (mode.isDefault ? defaultModeInput : modeInput).safeParse(raw);
    if (!parsed.success) throw new ModeError(400, mode.isDefault ? "the default mode only takes a name" : "invalid mode");
    const [row] = await tx.update(modes).set(parsed.data).where(eq(modes.id, mode.id)).returning();
    await touch(tx, phone, ctx.now());
    return row!;
  });
}

export async function deleteMode(ctx: Ctx, phone: Phone, modeId: string) {
  await ctx.db.transaction(async (tx) => {
    const [mode] = await tx.select().from(modes).where(and(eq(modes.id, modeId), eq(modes.phoneId, phone.id))).for("update");
    if (!mode) throw new ModeError(404, "mode not found");
    if (mode.isDefault) throw new ModeError(409, "the default mode cannot be deleted");
    await tx.delete(modes).where(eq(modes.id, mode.id));
    await touch(tx, phone, ctx.now());
  });
}

/** Replaces the weekly schedule. Slots may not overlap or use the default mode. */
export async function setSchedule(ctx: Ctx, phone: Phone, slots: SlotInput[]) {
  if (overlaps(slots)) throw new ModeError(400, "overlap");
  return ctx.db.transaction(async (tx) => {
    await tx.select({ id: phones.id }).from(phones).where(eq(phones.id, phone.id)).for("update");
    const own = await tx.select().from(modes).where(eq(modes.phoneId, phone.id));
    for (const s of slots) {
      const mode = own.find((m) => m.id === s.modeId);
      if (!mode) throw new ModeError(400, "unknown mode");
      if (mode.isDefault) throw new ModeError(400, "the default mode applies outside the schedule");
    }
    await tx.delete(modeSlots).where(eq(modeSlots.phoneId, phone.id));
    const rows = slots.length
      ? await tx.insert(modeSlots).values(slots.map((s, i) => ({
        ...s, phoneId: phone.id, createdAt: new Date(ctx.now().getTime() + i),
      }))).returning()
      : [];
    await touch(tx, phone, ctx.now());
    return rows;
  });
}

function isoWeekday(year: number, month: number, day: number): number {
  return ((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7) + 1;
}

function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** Slots on at [now] in the phone's wall-clock time; the same rule as the phone's `Schedules.active`. */
export function activeSlots<S extends Pick<Slot, "days" | "startMinute" | "endMinute">>(slots: S[], now: Date, timeZone: string): S[] {
  const t = localTime(now, timeZone);
  const today = isoWeekday(t.year, t.month, t.day);
  const yesterday = today === 1 ? 7 : today - 1;
  const minute = t.hour * 60 + t.minute;
  return slots.filter((s) => s.startMinute < s.endMinute
    ? s.days.includes(today) && minute >= s.startMinute && minute < s.endMinute
    : (s.days.includes(today) && minute >= s.startMinute) || (s.days.includes(yesterday) && minute < s.endMinute));
}

/** The mode on now, for the dashboard: a quiet slot wins, else the one that ends last. */
export function currentMode(list: Mode[], slots: Slot[], now: Date, timeZone: string) {
  const fallback = list.find((m) => m.isDefault);
  const active = activeSlots(slots, now, timeZone)
    .map((s) => ({ s, mode: list.find((m) => m.id === s.modeId) }))
    .filter((x): x is { s: Slot; mode: Mode } => x.mode !== undefined);
  if (active.length === 0) return fallback ? { modeId: fallback.id, until: null } : null;
  const quiet = active.filter((x) => x.mode.quiet);
  const pick = (quiet.length ? quiet : active).reduce((a, b) => (b.s.endMinute > a.s.endMinute ? b : a));
  return { modeId: pick.mode.id, until: hhmm(pick.s.endMinute) };
}

export function modeJson(m: Mode) {
  return {
    id: m.id,
    preset: m.preset,
    name: m.name,
    allApps: m.allApps,
    allowedPackages: [...m.allowedPackages].sort(),
    contactGroups: CONTACT_GROUPS.filter((g) => m.contactGroups.includes(g)),
    quiet: m.quiet,
    isDefault: m.isDefault,
  };
}

export function slotJson(s: Slot) {
  return { id: s.id, modeId: s.modeId, days: s.days, startMinute: s.startMinute, endMinute: s.endMinute };
}

/**
 * What modes put in the rules document. `schedules` replaces the school time and bedtime table, so a
 * phone from before modes still follows the apps and the quiet of each slot; `block` carries the
 * names and the contact groups for phones that know modes.
 *
 * @param allowed the apps the rules document allows; a quiet mode that allows every app sends them.
 */
export function modesForRules(list: Mode[], slots: Slot[], allowed: string[]) {
  const sorted = (xs: string[]) => [...xs].sort();
  const schedulesOut = slots.flatMap((s) => {
    const mode = list.find((m) => m.id === s.modeId);
    if (!mode || mode.isDefault || (mode.allApps && !mode.quiet)) return [];
    return [{
      id: s.id,
      kind: mode.quiet ? "bedtime" as const : "school" as const,
      days: s.days,
      start: hhmm(s.startMinute),
      end: hhmm(s.endMinute),
      allowedPackages: sorted(mode.allApps ? allowed : mode.allowedPackages),
    }];
  });
  const fallback = list.find((m) => m.isDefault);
  return {
    schedules: schedulesOut,
    block: {
      enabled: true,
      defaultModeId: fallback?.id ?? null,
      list: list.map((m) => {
        const { isDefault: _, ...rest } = modeJson(m);
        // The default mode is the normal rules, whatever is stored.
        return m.isDefault ? { ...rest, allApps: true, allowedPackages: [], contactGroups: [...CONTACT_GROUPS], quiet: false } : rest;
      }),
      slots: slots
        .filter((s) => list.some((m) => m.id === s.modeId && !m.isDefault))
        .map((s) => ({ id: s.id, modeId: s.modeId, days: s.days, start: hhmm(s.startMinute), end: hhmm(s.endMinute) })),
    },
  };
}

/** The group the phone uses for a contact: a parent is always Family. */
export function effectiveGroup(c: { sosParent: boolean; contactGroup: ContactGroup }): ContactGroup {
  return c.sosParent ? "family" : c.contactGroup;
}
