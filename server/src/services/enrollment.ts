// SPDX-License-Identifier: Apache-2.0
//
// Dashboard setup without a computer. The parent adds a phone in the dashboard and gets a
// provisioning QR code built in the browser. The QR carries a one-time enrollment token; after
// setup the phone sends it to POST /device/enroll and is paired with that phone entry, no code.
// The maintenance PIN is hashed in the browser and never reaches the server.

import { randomBytes } from "node:crypto";
import { and, eq, isNull, lt, ne } from "drizzle-orm";
import { enrollments, households, phones, users } from "../db/schema.js";
import { randomToken, safeEqualHex, sha256 } from "../lib/crypto.js";
import { sendInitialKeyInvite, setInitialSelfKey, type InitialSelfKey } from "./initial-self-key.js";
import type { Ctx } from "./context.js";
import { pairingAccount } from "./pairing-account.js";

export const ENROLLMENT_HOURS = 24;
/** A phone whose answer got lost may ask again with the same token and install id this long. */
export const ENROLLMENT_RETRY_MINUTES = 60;
export const ENROLLMENT_PREFIX = "pp_e_";
const ADMIN_COMPONENT = "org.plainphone.app/.PlainphoneAdminReceiver";

/** 128 random bits, short on purpose: every character makes the QR code denser. */
export function enrollmentToken(): string {
  return ENROLLMENT_PREFIX + randomBytes(16).toString("base64url");
}

/** What the dashboard needs to build the provisioning QR code (besides the PIN hash it makes itself). */
export function provisioningInfo(ctx: Ctx) {
  return {
    adminComponent: ADMIN_COMPONENT,
    downloadUrl: `${ctx.cfg.PUBLIC_URL.replace(/\/$/, "")}/download/android`,
    signatureChecksum: ctx.cfg.APK_SIGNATURE_CHECKSUM,
    serverUrl: ctx.cfg.PUBLIC_URL.replace(/\/$/, ""),
    dnsHost: ctx.cfg.PROVISIONING_DNS_HOST,
  };
}

/** Issues a fresh token for a phone that has not paired yet. Older tokens for it stop working. */
export async function issueEnrollment(ctx: Ctx, phoneId: string, userId: string) {
  const token = enrollmentToken();
  const expiresAt = new Date(ctx.now().getTime() + ENROLLMENT_HOURS * 3_600_000);
  await ctx.db.transaction(async (tx) => {
    // Keep as little as possible: tokens past their retry window have no use any more.
    await tx.delete(enrollments).where(lt(enrollments.expiresAt, new Date(ctx.now().getTime() - 3_600_000)));
    await tx.delete(enrollments).where(eq(enrollments.phoneId, phoneId));
    await tx.insert(enrollments).values({ tokenHash: sha256(token), phoneId, createdBy: userId, expiresAt });
  });
  return { token, expiresAt: expiresAt.toISOString() };
}

export type EnrollResult =
  | { status: 200; phoneId: string; deviceToken: string; setupUndoMinutes: number | null; account: ReturnType<typeof pairingAccount> }
  | { status: 400 | 404 | 410; error: string };

/**
 * Redeems a token. One-time: the first phone wins. The same phone (same install id) may ask again
 * for a short while, in case the answer was lost on the way; it then gets a new device token and
 * the earlier one stops working.
 */
export async function redeemEnrollment(
  ctx: Ctx,
  input: { key?: InitialSelfKey; token: string; installId: string; deviceInfo: Record<string, string> | null },
  devicePrefix: string,
): Promise<EnrollResult> {
  const deviceToken = randomToken(devicePrefix);
  const installHash = sha256(input.installId);
  const now = ctx.now();
  const result = await ctx.db.transaction(async (tx): Promise<EnrollResult & { ownerId?: string | null }> => {
    const [e] = await tx.select().from(enrollments).where(eq(enrollments.tokenHash, sha256(input.token))).for("update");
    if (!e) return { status: 404, error: "unknown setup code" };
    const [phone] = await tx.select().from(phones).where(eq(phones.id, e.phoneId)).for("update");
    if (!phone) return { status: 404, error: "unknown setup code" };

    const paired = async () => {
      const [user] = phone.mode === "strong" && e.createdBy
        ? await tx.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, e.createdBy))
        : [];
      const [household] = user
        ? await tx.select({ name: households.name }).from(households).where(eq(households.id, phone.householdId))
        : [];
      const account = pairingAccount(e.createdBy, user, household?.name ?? null);
      return { status: 200 as const, phoneId: phone.id, deviceToken, account, setupUndoMinutes: phone.mode === "light" ? phone.setupUndoMinutes : null };
    };

    if (e.usedAt) {
      const retry =
        e.installIdHash !== null &&
        safeEqualHex(e.installIdHash, installHash) &&
        now.getTime() - e.usedAt.getTime() <= ENROLLMENT_RETRY_MINUTES * 60_000;
      if (!retry) return { status: 410, error: "this setup code was already used" };
      await tx.update(phones).set({ deviceTokenHash: sha256(deviceToken) }).where(eq(phones.id, phone.id));
      return paired();
    }
    if (e.expiresAt <= now) return { status: 410, error: "this setup code has expired; make a new one in the dashboard" };
    // Paired some other way meanwhile (a pairing code): the entry is taken.
    if (phone.deviceTokenHash !== null) return { status: 410, error: "this phone is already paired" };

    if (input.key && !(await setInitialSelfKey(tx, phone, input.key, now))) return { status: 400, error: "invalid setup key" };

    await tx
      .update(phones)
      .set({ deviceTokenHash: sha256(deviceToken), pairedAt: now, deviceInfo: input.deviceInfo })
      .where(and(eq(phones.id, phone.id), isNull(phones.deviceTokenHash)));
    await tx.update(enrollments).set({ usedAt: now, installIdHash: installHash }).where(eq(enrollments.id, e.id));
    await tx.delete(enrollments).where(and(eq(enrollments.phoneId, phone.id), ne(enrollments.id, e.id)));
    return { ...(await paired()), ownerId: e.createdBy };
  });
  if ("ownerId" in result && result.ownerId) await sendInitialKeyInvite(ctx, input.key, result.ownerId);
  return result;
}
