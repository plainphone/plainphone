// SPDX-License-Identifier: Apache-2.0
import { errorSummary } from "../lib/log.js";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { householdMembers, pendingChanges, phones, selfKeys, users } from "../db/schema.js";
import { inviteMail } from "../lib/mail-templates.js";
import { toLocale } from "../lib/locale.js";
import { email } from "../lib/validation.js";
import type { Ctx } from "./context.js";

const waitHours = z.union([z.literal(1), z.literal(6), z.literal(12), z.literal(24), z.literal(48), z.literal(72)]);
export const initialSelfKey = z.discriminatedUnion("keyType", [
  z.object({ keyType: z.literal("delay"), delayHours: waitHours }),
  z.object({ keyType: z.literal("trusted"), trustedEmail: email }),
  z.object({ keyType: z.literal("trustedQr") }),
]);
export type InitialSelfKey = z.infer<typeof initialSelfKey>;
type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

/** Only called while the pairing or enrollment transaction holds the phone lock. */
export async function setInitialSelfKey(tx: Tx, phone: typeof phones.$inferSelect, choice: InitialSelfKey, now: Date) {
  if (phone.profile !== "self" || phone.pairedAt || phone.deviceTokenHash) return false;

  let trustedUserId: string | null = null;
  if (choice.keyType === "trusted") {
    const [helper] = await tx.select({ id: users.id, member: householdMembers.userId }).from(users)
      .leftJoin(householdMembers, and(eq(householdMembers.userId, users.id), eq(householdMembers.householdId, phone.householdId)))
      .where(eq(users.email, choice.trustedEmail));
    if (helper?.member) return false;
    trustedUserId = helper?.id ?? null;
  }

  await tx.update(selfKeys).set({
    keyType: choice.keyType === "delay" ? "delay" : "trusted",
    delayHours: choice.keyType === "delay" ? choice.delayHours : 24,
    trustedEmail: choice.keyType === "trusted" ? choice.trustedEmail : null,
    trustedUserId,
  }).where(eq(selfKeys.phoneId, phone.id));
  // A dashboard key queued by an older version must not replace the phone's choice.
  await tx.update(pendingChanges).set({ status: "cancelled", decidedAt: now }).where(and(
    eq(pendingChanges.phoneId, phone.id), eq(pendingChanges.status, "pending"),
    sql`${pendingChanges.op}->>'type' = 'key.set'`,
  ));
  return true;
}


export async function sendInitialKeyInvite(ctx: Ctx, choice: InitialSelfKey | undefined, ownerId: string | null) {
  if (choice?.keyType !== "trusted" || !ctx.mail.canSend) return;
  try {
    const [owner] = ownerId ? await ctx.db.select({ locale: users.locale }).from(users).where(eq(users.id, ownerId)) : [];
    await ctx.mail.send(inviteMail(choice.trustedEmail, toLocale(owner?.locale), ctx.cfg.PUBLIC_URL,
      `${ctx.cfg.PUBLIC_URL}/login`, "trusted", 30));
  } catch (err) {
    console.error("could not send setup key invitation", errorSummary(err));
  }
}
