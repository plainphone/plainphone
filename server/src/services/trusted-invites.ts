// SPDX-License-Identifier: Apache-2.0
import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { householdInvites, householdMembers, pendingChanges, phones, selfKeys } from "../db/schema.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import type { Ctx } from "./context.js";

export const TRUSTED_INVITE_PREFIX = "pp_t_";

export async function issueTrustedInvite(ctx: Ctx, phoneId: string, actor: { userId: string } | { deviceHash: string | null }) {
  return ctx.db.transaction(async (tx) => {
    const [phone] = await tx.select().from(phones).where(eq(phones.id, phoneId)).for("update");
    if (!phone || phone.profile !== "self" || !phone.pairedAt) return null;
    if ("userId" in actor) {
      const [member] = await tx.select().from(householdMembers).where(and(
        eq(householdMembers.householdId, phone.householdId), eq(householdMembers.userId, actor.userId),
      ));
      if (!member) return null;
    } else if (!actor.deviceHash || phone.deviceTokenHash !== actor.deviceHash) return null;
    const [key] = await tx.select().from(selfKeys).where(eq(selfKeys.phoneId, phone.id));
    if (key?.keyType !== "trusted" || key.trustedUserId || key.trustedEmail) return null;
    const token = randomToken(TRUSTED_INVITE_PREFIX);
    const expiresAt = new Date(ctx.now().getTime() + 15 * 60_000);
    await tx.delete(householdInvites).where(eq(householdInvites.trustedPhoneId, phoneId));
    await tx.insert(householdInvites).values({
      householdId: phone.householdId, trustedPhoneId: phoneId, email: "",
      tokenHash: sha256(token), expiresAt, invitedBy: "userId" in actor ? actor.userId : null,
    });
    return { url: `${ctx.cfg.PUBLIC_URL.replace(/\/$/, "")}/invite/trusted#token=${token}`, expiresAt: expiresAt.toISOString() };
  });
}

export async function acceptTrustedInvite(ctx: Ctx, token: string, user: { id: string; email: string }) {
  const match = and(eq(householdInvites.tokenHash, sha256(token)), isNotNull(householdInvites.trustedPhoneId),
    isNull(householdInvites.acceptedAt));
  return ctx.db.transaction(async (tx) => {
    const [target] = await tx.select({ phoneId: householdInvites.trustedPhoneId }).from(householdInvites).where(match);
    if (!target?.phoneId) return false;
    const [phone] = await tx.select().from(phones).where(eq(phones.id, target.phoneId)).for("update");
    if (!phone || phone.profile !== "self" || !phone.pairedAt) return false;
    const [member] = await tx.select().from(householdMembers).where(and(
      eq(householdMembers.householdId, phone.householdId), eq(householdMembers.userId, user.id),
    ));
    if (member) return false;
    const [key] = await tx.select().from(selfKeys).where(eq(selfKeys.phoneId, phone.id));
    if (key?.keyType !== "trusted" || key.trustedUserId || key.trustedEmail) return false;
    const [invite] = await tx.delete(householdInvites)
      .where(and(match, gt(householdInvites.expiresAt, ctx.now()))).returning({ id: householdInvites.id });
    if (!invite) return false;
    await tx.update(selfKeys).set({ trustedUserId: user.id, trustedEmail: user.email }).where(eq(selfKeys.phoneId, phone.id));
    await tx.update(pendingChanges).set({ keyType: "trusted", effectiveAt: null, awaitingQrHelper: false }).where(and(
      eq(pendingChanges.phoneId, phone.id), eq(pendingChanges.status, "pending"), eq(pendingChanges.keyType, "delay"),
      eq(pendingChanges.awaitingQrHelper, true), gt(pendingChanges.effectiveAt, ctx.now()),
      sql`${pendingChanges.requestedBy} is distinct from ${user.id}`,
    ));
    return true;
  });
}
