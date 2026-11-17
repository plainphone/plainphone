// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  contacts,
  DNS_CATEGORIES,
  dnsSettings,
  locations,
  pendingChanges,
  phoneApps,
  phoneSettings,
  phoneRequests,
  phones,
  schedules,
  selfKeys,
} from "../db/schema.js";
import { dnsClientId } from "../lib/crypto.js";
import { fullHome, fullSettings, rulesSettings } from "../lib/phone-settings.js";
import type { Ctx } from "./context.js";
import { loadTimeLimits } from "./limits.js";
import { FAST_POLL_SECONDS, loadSafety, safetyForPhone } from "./safety.js";

type Phone = typeof phones.$inferSelect;
type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

/** How often the phone polls for rules when push is not available. */
export const POLL_SECONDS = 60;
/** How often the phone reports its position when location is on (spec: every 5 minutes). */
export const LOCATION_INTERVAL_MINUTES = 5;
/** What older phones (without `location.mode`) get as interval when the mode is not "always". */
export const OLD_PHONE_INTERVAL_MINUTES = 24 * 60;

/** Starter packs now come from the app catalog (`starter: true`). Re-exported for older imports. */
export { STARTER_PACKS } from "./catalog.js";

export async function createPhone(
  ctx: Ctx,
  tx: Tx,
  input: {
    householdId: string;
    name: string;
    profile: "child" | "self";
    mode: "strong" | "light";
    /** Null for a phone made for a provisioning QR code: it pairs itself later (enrollment). */
    deviceTokenHash: string | null;
    deviceInfo: Record<string, string> | null;
    timezone?: string;
  },
): Promise<Phone> {
  // Runs inside the caller's transaction, together with the pairing it claims.
  const [phone] = await tx
    .insert(phones)
    .values({
      householdId: input.householdId,
      name: input.name,
      profile: input.profile,
      mode: input.mode,
      deviceTokenHash: input.deviceTokenHash,
      deviceInfo: input.deviceInfo,
      dnsClientId: dnsClientId(),
      // D7 and spec 11: a child's phone sends its position only on Find and an unanswered
      // "Are you okay?"; an adult's is off until its owner turns it on.
      locationEnabled: input.profile === "child",
      locationMode: input.profile === "child" ? "checkin" : "off",
      timezone: input.timezone ?? "Europe/Copenhagen",
      pairedAt: input.deviceTokenHash ? ctx.now() : null,
    })
    .returning();
  // Spec 6: every category is blocked by default.
  await tx.insert(dnsSettings).values({ phoneId: phone!.id, blockedCategories: [...DNS_CATEGORIES] });
  if (input.profile === "self") await tx.insert(selfKeys).values({ phoneId: phone!.id });
  return phone!;
}

/** Asks the phone to fetch rules (or report its position) now. Polling is the fallback. */
export async function wakePhone(ctx: Ctx, phoneId: string, reason: "rules" | "locate") {
  const [p] = await ctx.db.select({ token: phones.fcmToken }).from(phones).where(eq(phones.id, phoneId));
  if (!p?.token) return;
  try {
    await ctx.push.wake(p.token, reason);
  } catch (err) {
    console.error(`push to phone ${phoneId} failed: ${(err as Error).message}`);
  }
}

async function readPhoneSettings(db: Ctx["db"], phoneId: string) {
  const [row] = await db
    .select({ settings: phoneSettings.settings, home: phoneSettings.home })
    .from(phoneSettings)
    .where(eq(phoneSettings.phoneId, phoneId));
  return row;
}

/** The phone's own settings and home screen, with the defaults filled in. */
export async function loadPhoneSettings(db: Ctx["db"], phoneId: string) {
  const row = await readPhoneSettings(db, phoneId);
  return { stored: row?.settings ?? {}, settings: fullSettings(row?.settings), home: fullHome(row?.home) };
}

function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

async function loadRulesInputs(ctx: Ctx, phone: Phone) {
  const [allApps, contactRows, scheduleRows, dnsRow, pending, limits, safetyRows, own] = await Promise.all([
    ctx.db
      .select({
        packageName: phoneApps.packageName,
        label: phoneApps.label,
        installed: phoneApps.installed,
        core: phoneApps.core,
        allowed: phoneApps.allowed,
        requested: phoneApps.requested,
      })
      .from(phoneApps)
      .where(
        and(
          eq(phoneApps.phoneId, phone.id),
          or(eq(phoneApps.installed, true), and(eq(phoneApps.requested, true), eq(phoneApps.allowed, true))),
        ),
      )
      .orderBy(phoneApps.packageName),
    ctx.db
      .select({ name: contacts.name, number: contacts.number })
      .from(contacts)
      .where(eq(contacts.phoneId, phone.id))
      .orderBy(contacts.name, contacts.number),
    ctx.db
      .select({
        id: schedules.id,
        kind: schedules.kind,
        days: schedules.days,
        startMinute: schedules.startMinute,
        endMinute: schedules.endMinute,
        allowedPackages: schedules.allowedPackages,
      })
      .from(schedules)
      .where(eq(schedules.phoneId, phone.id))
      .orderBy(schedules.createdAt),
    ctx.db
      .select({ blockedCategories: dnsSettings.blockedCategories })
      .from(dnsSettings)
      .where(eq(dnsSettings.phoneId, phone.id)),
    ctx.db
      .select({
        id: pendingChanges.id,
        op: pendingChanges.op,
        keyType: pendingChanges.keyType,
        effectiveAt: pendingChanges.effectiveAt,
      })
      .from(pendingChanges)
      .where(and(eq(pendingChanges.phoneId, phone.id), eq(pendingChanges.status, "pending")))
      .orderBy(pendingChanges.createdAt),
    loadTimeLimits(ctx.db, phone, ctx.now()),
    loadSafety(ctx, phone.id),
    readPhoneSettings(ctx.db, phone.id),
    loadPhoneSettings(ctx.db, phone.id),
  ]);
  const safety = safetyForPhone(phone, safetyRows, ctx.now());
  return {
    phone: {
      id: phone.id,
      profile: phone.profile,
      mode: phone.mode,
      timezone: phone.timezone,
      dnsHost: `${phone.dnsClientId}.${ctx.cfg.DNS_HOST_SUFFIX}`,
      dnsReady: phone.dnsConfirmedAt !== null,
      locationEnabled: phone.locationEnabled,
      locationMode: phone.locationMode,
      locationAlwaysUntil: phone.locationAlwaysUntil,
      locateRequestedAt: phone.locateRequestedAt,
    },
    allApps,
    contactRows,
    scheduleRows,
    dnsRow,
    pending,
    limits,
    safety,
    own,
  };
}

type RulesInputs = Awaited<ReturnType<typeof loadRulesInputs>>;

/** The rules document the phone fetches. Its ETag is a hash of the content. */
function rulesDocument({ phone, allApps, contactRows, scheduleRows, dnsRow, pending, limits, safety, own }: RulesInputs) {
  const apps = allApps.filter((a) => a.installed);
  const sorted = (xs: string[]) => [...xs].sort();
  const doc = {
    phoneId: phone.id,
    profile: phone.profile,
    mode: phone.mode,
    timezone: phone.timezone,
    apps: {
      allowed: sorted(apps.filter((a) => a.allowed || a.core).map((a) => a.packageName)),
      hidden: sorted(apps.filter((a) => !a.allowed && !a.core).map((a) => a.packageName)),
      // Picked from the catalog but not installed yet: the phone offers to install them.
      toInstall: allApps
        .filter((a) => a.requested && a.allowed && !a.installed)
        .map((a) => ({ packageName: a.packageName, label: a.label })),
    },
    timeLimits: { total: limits.total, apps: limits.apps.map((a) => ({ packageName: a.packageName, ...a.limit })), bonuses: limits.bonuses },
    contacts: contactRows.map((c) => ({ name: c.name, number: c.number })),
    schedules: scheduleRows.map((s) => ({
      id: s.id,
      kind: s.kind,
      days: s.days,
      start: hhmm(s.startMinute),
      end: hhmm(s.endMinute),
      allowedPackages: sorted(s.allowedPackages),
    })),
    dns: {
      host: phone.dnsHost,
      // The phone switches to `host` only when this is true: the DNS service refuses ClientIDs
      // it has not accepted yet, and a phone on a refusing resolver has no DNS at all.
      ready: phone.dnsReady,
      blockedCategories: sorted(dnsRow[0]?.blockedCategories ?? []),
    },
    location: {
      enabled: phone.locationEnabled,
      mode: phone.locationMode,
      alwaysUntil: phone.locationMode === "always" ? (phone.locationAlwaysUntil?.toISOString() ?? null) : null,
      // Phones from before `mode` report every intervalMinutes while enabled: give them a day
      // unless the parent chose "always".
      intervalMinutes: phone.locationMode === "always" ? LOCATION_INTERVAL_MINUTES : OLD_PHONE_INTERVAL_MINUTES,
      requestedAt: phone.locationEnabled ? (phone.locateRequestedAt?.toISOString() ?? null) : null,
    },
    // Only settings that are not free, keys in alphabetical order (a stable ETag).
    settings: rulesSettings(own?.settings ?? {}),
    home: fullHome(own?.home),
    ring: safety.ring,
    checkIn: safety.checkIn,
    pendingChanges: pending.map((c) => ({
      id: c.id,
      op: c.op,
      keyType: c.keyType,
      effectiveAt: c.effectiveAt?.toISOString() ?? null,
    })),
    pollSeconds: safety.fast ? FAST_POLL_SECONDS : POLL_SECONDS,
  };
  const body = JSON.stringify(doc);
  const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
  return { body, etag };
}

export function createRulesResponder(ctx: Ctx) {
  // Refresh every input from Postgres, including time-dependent safety and bonuses.
  // Cache only small inputs and only recent phones. A restart or miss hashes the same body.
  const recent = new Map<string, { etag: string; inputs: RulesInputs }>();
  return async (phone: Phone, candidates: string[]) => {
    const inputs = await loadRulesInputs(ctx, phone);
    const cached = recent.get(phone.id);
    if (cached && candidates.includes(cached.etag) && isDeepStrictEqual(cached.inputs, inputs)) {
      return { etag: cached.etag, body: null };
    }

    const { body, etag } = rulesDocument(inputs);
    recent.delete(phone.id);
    if (body.length <= 16_384 && JSON.stringify(inputs).length <= 32_768) {
      if (recent.size >= 8) recent.delete(recent.keys().next().value!);
      recent.set(phone.id, { etag, inputs });
    }
    return { etag, body: candidates.includes(etag) ? null : body };
  };
}

function summaryFields() {
  // Qualify the outer reference even in Drizzle's single-table select.
  const phoneId = sql`${phones}.${sql.identifier(phones.id.name)}`;
  return {
    hasLocation: sql<boolean>`exists (select 1 from ${locations} where ${locations.phoneId} = ${phoneId})`,
    openRequests: sql<number>`(select count(*)::int from ${phoneRequests}
      where ${phoneRequests.phoneId} = ${phoneId} and ${phoneRequests.status} = 'pending')`,
  };
}

export async function phoneSummaries(ctx: Ctx, householdIds: string[]) {
  const rows = await ctx.db
    .select({ phone: phones, ...summaryFields() })
    .from(phones)
    .where(inArray(phones.householdId, householdIds))
    .orderBy(phones.createdAt);
  return rows.map(({ phone, hasLocation, openRequests }) => summaryJson(ctx, phone, hasLocation, openRequests));
}

export async function phoneSummary(ctx: Ctx, phone: Phone) {
  const [row] = await ctx.db.select(summaryFields()).from(phones).where(eq(phones.id, phone.id));
  return summaryJson(ctx, phone, row?.hasLocation ?? false, row?.openRequests ?? 0);
}

function summaryJson(ctx: Ctx, phone: Phone, hasLocation: boolean, openRequests: number) {
  return {
    id: phone.id,
    name: phone.name,
    profile: phone.profile,
    mode: phone.mode,
    timezone: phone.timezone,
    locationEnabled: phone.locationEnabled,
    locationMode: phone.locationMode,
    pairedAt: phone.pairedAt?.toISOString() ?? null,
    lastSeenAt: phone.lastSeenAt?.toISOString() ?? null,
    dnsHost: `${phone.dnsClientId}.${ctx.cfg.DNS_HOST_SUFFIX}`,
    dnsSynced: !phone.dnsDirty,
    dnsReady: phone.dnsConfirmedAt !== null,
    hasLocation,
    openRequests,
    /** Null means the server default (`offlineAlertHoursDefault`). */
    offlineAlertHours: phone.offlineAlertHours,
    offlineAlertHoursDefault: ctx.cfg.OFFLINE_ALERT_HOURS,
    status:
      phone.deviceStatus && phone.statusReportedAt
        ? { ...phone.deviceStatus, reportedAt: phone.statusReportedAt.toISOString() }
        : null,
  };
}
