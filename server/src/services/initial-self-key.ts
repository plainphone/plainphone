// SPDX-License-Identifier: Apache-2.0
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { householdMembers, pendingChanges, phones, selfKeys, users } from "../db/schema.js";
import { inviteMail, toLocale } from "../lib/mail-templates.js";
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
export async function setInitialSelfKey(tx: Tx, phone: typeof phones.$inferSelect, choice: InitialSelfKey) {
  if (phone.profile !== "self" || phone.pairedAt || phone.deviceTokenHash) return false;
  const [pending] = await tx.select({ id: pendingChanges.id }).from(pendingChanges)
    .where(eq(pendingChanges.phoneId, phone.id)).limit(1);
  if (pending) return false;
  if (choice.keyType === "delay") {
    await tx.update(selfKeys).set({ keyType: "delay", delayHours: choice.delayHours, trustedEmail: null, trustedUserId: null })
      .where(eq(selfKeys.phoneId, phone.id));
    return true;
  }
  if (choice.keyType === "trustedQr") {
    await tx.update(selfKeys).set({ keyType: "trusted", delayHours: 24, trustedEmail: null, trustedUserId: null })
      .where(eq(selfKeys.phoneId, phone.id));
    return true;
  }
  const [helper] = await tx.select({ id: users.id, member: householdMembers.userId }).from(users)
    .leftJoin(householdMembers, and(eq(householdMembers.userId, users.id), eq(householdMembers.householdId, phone.householdId)))
    .where(eq(users.email, choice.trustedEmail));
  if (helper?.member) return false;
  await tx.update(selfKeys).set({ keyType: "trusted", delayHours: 24, trustedEmail: choice.trustedEmail, trustedUserId: helper?.id ?? null })
    .where(eq(selfKeys.phoneId, phone.id));
  return true;
}


export async function sendInitialKeyInvite(ctx: Ctx, choice: InitialSelfKey | undefined, ownerId: string | null) {
  if (choice?.keyType !== "trusted" || !ctx.mail.canSend) return;
  try {
    const [owner] = ownerId ? await ctx.db.select({ locale: users.locale }).from(users).where(eq(users.id, ownerId)) : [];
    await ctx.mail.send(inviteMail(choice.trustedEmail, toLocale(owner?.locale), ctx.cfg.PUBLIC_URL,
      `${ctx.cfg.PUBLIC_URL}/login`, "trusted", 30));
  } catch (err) {
    console.error("could not send setup key invitation", (err as Error).message);
  }
}
