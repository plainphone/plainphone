// SPDX-License-Identifier: Apache-2.0
//
// Dashboard setup without a computer. The parent adds a phone in the dashboard and gets a
// provisioning QR code built in the browser. The QR carries a one-time enrollment token; after
// setup the phone sends it to POST /device/enroll and is paired with that phone entry, no code.
// The maintenance PIN is hashed in the browser and never reaches the server.

import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, isNull, lt, ne } from "drizzle-orm";
import { enrollments, households, phones, users } from "../db/schema.js";
import { randomToken, safeEqualHex, sha256 } from "../lib/crypto.js";
import { provisioningInfo } from "../lib/provisioning.js";
import { sendInitialKeyInvite, setInitialSelfKey, type InitialSelfKey } from "./initial-self-key.js";
import type { Ctx } from "./context.js";
import { pairingAccount } from "./pairing-account.js";

export const ENROLLMENT_HOURS = 24;
/** A phone whose answer got lost may ask again with the same token and install id this long. */
export const ENROLLMENT_RETRY_MINUTES = 60;
export const ENROLLMENT_PREFIX = "pp_e_";
const OUTDATED_QR = "This QR code is out of date. Make a new one.";
type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

/** 128 random bits, short on purpose: every character makes the QR code denser. */
export function enrollmentToken(): string {
  return ENROLLMENT_PREFIX + randomBytes(16).toString("base64url");
}

export function enrollmentMatches(ctx: Ctx, e: typeof enrollments.$inferSelect, phone: typeof phones.$inferSelect) {
  return !e.invalidatedAt && isDeepStrictEqual(e.provisioning, provisioningInfo(ctx.cfg, phone));
}

export async function invalidateEnrollments(tx: Tx, phoneId: string, now: Date) {
  await tx.update(enrollments).set({ invalidatedAt: now }).where(and(
    eq(enrollments.phoneId, phoneId), isNull(enrollments.usedAt), isNull(enrollments.invalidatedAt),
  ));
}

/** All enrollment operations lock the phone first, then read and lock the token. */
export async function lockEnrollment(tx: Tx, token: string) {
  const tokenHash = sha256(token);
  const [phone] = await tx.select().from(phones).where(eq(phones.id,
    tx.select({ id: enrollments.phoneId }).from(enrollments).where(eq(enrollments.tokenHash, tokenHash)),
  )).for("update");
  if (!phone) return null;
  const [enrollment] = await tx.select().from(enrollments).where(eq(enrollments.tokenHash, tokenHash)).for("update");
  return enrollment ? { phone, enrollment } : null;
}

/** Issues a fresh token and returns the exact server-controlled QR values bound to it. */
export async function issueEnrollment(ctx: Ctx, phoneId: string, userId: string) {
  const token = enrollmentToken();
  const now = ctx.now();
  const expiresAt = new Date(now.getTime() + ENROLLMENT_HOURS * 3_600_000);
  // Prune outside the phone transaction so cleanup never locks other phones' tokens under that lock.
  await ctx.db.delete(enrollments).where(lt(enrollments.expiresAt, new Date(now.getTime() - 3_600_000)));
  return ctx.db.transaction(async (tx) => {
    const [phone] = await tx.select().from(phones).where(eq(phones.id, phoneId)).for("update");
    if (!phone || phone.pairedAt || phone.deviceTokenHash) return null;
    const provisioning = provisioningInfo(ctx.cfg, phone);
    await tx.delete(enrollments).where(and(eq(enrollments.phoneId, phoneId), isNull(enrollments.invalidatedAt)));
    const [row] = await tx.insert(enrollments).values({
      tokenHash: sha256(token), phoneId, createdBy: userId, expiresAt, provisioning,
    }).returning({ id: enrollments.id });
    return { enrollment: { id: row!.id, token, expiresAt: expiresAt.toISOString() }, provisioning };
  });
}

export type EnrollResult =
  | { status: 200; phoneId: string; deviceToken: string; setupUndoMinutes: number | null; account: ReturnType<typeof pairingAccount> }
  | { status: 400 | 404 | 409 | 410; error: string };

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
    const locked = await lockEnrollment(tx, input.token);
    if (!locked) return { status: 404, error: "unknown setup code" };
    const { enrollment: e, phone } = locked;

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

    // Recover an accepted enrollment even if the parent changed the app language after pairing.
    if (e.usedAt) {
      const retry =
        e.installIdHash !== null &&
        safeEqualHex(e.installIdHash, installHash) &&
        now.getTime() - e.usedAt.getTime() <= ENROLLMENT_RETRY_MINUTES * 60_000;
      if (!retry) return { status: 410, error: "this setup code was already used" };
      await tx.update(phones).set({ deviceTokenHash: sha256(deviceToken) }).where(eq(phones.id, phone.id));
      return paired();
    }
    if (!enrollmentMatches(ctx, e, phone)) return { status: 409, error: OUTDATED_QR };
    if (e.expiresAt <= now) return { status: 410, error: "this setup code has expired; make a new one in the dashboard" };
    // Paired some other way meanwhile (a pairing code): the entry is taken.
    if (phone.deviceTokenHash !== null) return { status: 410, error: "this phone is already paired" };

    if (input.key && !(await setInitialSelfKey(tx, phone, input.key, now))) return { status: 400, error: "invalid setup key" };

    await tx
      .update(phones)
      .set({ deviceTokenHash: sha256(deviceToken), pairedAt: now, deviceInfo: input.deviceInfo })
      .where(and(eq(phones.id, phone.id), isNull(phones.deviceTokenHash)));
    await tx.update(enrollments).set({ usedAt: now, installIdHash: installHash }).where(eq(enrollments.id, e.id));
    await tx.delete(enrollments).where(and(eq(enrollments.phoneId, phone.id), ne(enrollments.id, e.id), isNull(enrollments.invalidatedAt)));
    return { ...(await paired()), ownerId: e.createdBy };
  });
  if ("ownerId" in result && result.ownerId) await sendInitialKeyInvite(ctx, input.key, result.ownerId);
  return result;
}
