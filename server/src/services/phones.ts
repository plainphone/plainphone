// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  contacts,
  DNS_CATEGORIES,
  dnsSettings,
  locations,
  pendingChanges,
  phoneApps,
  phones,
  schedules,
  selfKeys,
} from "../db/schema.js";
import { dnsClientId } from "../lib/crypto.js";
import type { Ctx } from "./context.js";

type Phone = typeof phones.$inferSelect;

/** How often the phone polls for rules when push is not available. */
export const POLL_SECONDS = 60;
/** How often the phone reports its position when location is on (spec: every 5 minutes). */
export const LOCATION_INTERVAL_MINUTES = 5;

/**
 * Apps allowed from the start when a phone reports them (spec: starter packs per
 * country). Package names are from the Play Store listings; check them on a real
 * phone before relying on them.
 */
export const STARTER_PACKS: Record<string, string[]> = {
  dk: [
    "dk.danskebank.mobilepay", // MobilePay
    "dk.mitid.app.android", // MitID
    "de.hafas.android.rejseplanen", // Rejseplanen
    "com.netcompany.aulanativeprivate", // Aula
    "dk.dr.radio", // DR LYD
    "com.spotify.music", // Spotify
  ],
};

export async function createPhone(
  ctx: Ctx,
  input: {
    householdId: string;
    name: string;
    profile: "child" | "self";
    mode: "strong" | "light";
    deviceTokenHash: string;
    deviceInfo: Record<string, string> | null;
    timezone?: string;
  },
): Promise<Phone> {
  return ctx.db.transaction(async (tx) => {
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
        // D7 and spec 11: location is on for a child, off by default for an adult.
        locationEnabled: input.profile === "child",
        timezone: input.timezone ?? "Europe/Copenhagen",
        pairedAt: ctx.now(),
      })
      .returning();
    // Spec 6: every category is blocked by default.
    await tx.insert(dnsSettings).values({ phoneId: phone!.id, blockedCategories: [...DNS_CATEGORIES] });
    if (input.profile === "self") await tx.insert(selfKeys).values({ phoneId: phone!.id });
    return phone!;
  });
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

function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** The rules document the phone fetches. Its ETag is a hash of the content. */
export async function rulesDocument(ctx: Ctx, phone: Phone) {
  const [apps, contactRows, scheduleRows, dnsRow, pending] = await Promise.all([
    ctx.db.select().from(phoneApps).where(and(eq(phoneApps.phoneId, phone.id), eq(phoneApps.installed, true))),
    ctx.db.select().from(contacts).where(eq(contacts.phoneId, phone.id)).orderBy(contacts.name, contacts.number),
    ctx.db.select().from(schedules).where(eq(schedules.phoneId, phone.id)).orderBy(schedules.createdAt),
    ctx.db.select().from(dnsSettings).where(eq(dnsSettings.phoneId, phone.id)),
    ctx.db
      .select()
      .from(pendingChanges)
      .where(and(eq(pendingChanges.phoneId, phone.id), eq(pendingChanges.status, "pending")))
      .orderBy(pendingChanges.createdAt),
  ]);
  const sorted = (xs: string[]) => [...xs].sort();
  const doc = {
    phoneId: phone.id,
    profile: phone.profile,
    mode: phone.mode,
    timezone: phone.timezone,
    apps: {
      allowed: sorted(apps.filter((a) => a.allowed || a.core).map((a) => a.packageName)),
      hidden: sorted(apps.filter((a) => !a.allowed && !a.core).map((a) => a.packageName)),
    },
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
      host: `${phone.dnsClientId}.${ctx.cfg.DNS_HOST_SUFFIX}`,
      blockedCategories: sorted(dnsRow[0]?.blockedCategories ?? []),
    },
    location: {
      enabled: phone.locationEnabled,
      intervalMinutes: LOCATION_INTERVAL_MINUTES,
      requestedAt: phone.locationEnabled ? (phone.locateRequestedAt?.toISOString() ?? null) : null,
    },
    pendingChanges: pending.map((c) => ({
      id: c.id,
      op: c.op,
      keyType: c.keyType,
      effectiveAt: c.effectiveAt?.toISOString() ?? null,
    })),
    pollSeconds: POLL_SECONDS,
  };
  const etag = `"${createHash("sha256").update(JSON.stringify(doc)).digest("base64url").slice(0, 27)}"`;
  return { doc, etag };
}

export async function phoneSummary(ctx: Ctx, phone: Phone) {
  const [loc] = await ctx.db.select().from(locations).where(eq(locations.phoneId, phone.id));
  return {
    id: phone.id,
    name: phone.name,
    profile: phone.profile,
    mode: phone.mode,
    timezone: phone.timezone,
    locationEnabled: phone.locationEnabled,
    pairedAt: phone.pairedAt?.toISOString() ?? null,
    lastSeenAt: phone.lastSeenAt?.toISOString() ?? null,
    dnsHost: `${phone.dnsClientId}.${ctx.cfg.DNS_HOST_SUFFIX}`,
    dnsSynced: !phone.dnsDirty,
    hasLocation: Boolean(loc),
  };
}
