// SPDX-License-Identifier: Apache-2.0
//
// Self-service account deletion (#11). What happens is documented in docs/account-deletion.md.

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import {
  householdInvites,
  householdMembers,
  households,
  magicLinks,
  pendingChanges,
  phones,
  selfKeys,
  users,
} from "../db/schema.js";
import type { Ctx } from "./context.js";
import { queueDnsDeletions, retryDnsDeletions } from "./dns.js";

export type DeleteAccountResult =
  | { status: "deleted"; householdsDeleted: number; phonesRemoved: number }
  | { status: "blocked"; selfPhoneIds: string[] };

/**
 * Deletes a user and everything only they could reach.
 *
 * - A household the user shares with another parent stays, with its phones. If the user
 *   owned it, the longest-standing other member becomes the owner.
 * - A household where the user is the only member is deleted with all its phones. The
 *   phones get 401 on their next poll and fall back like any removed phone.
 * - Refused while such a household holds a Self phone: removing a Self phone goes through
 *   its key, and deleting the account must not be a way around that. The user removes
 *   those phones first (through the key), then deletes the account.
 * - Where the user is someone's trusted person, that key falls back to the delay, and
 *   requests waiting for them start the delay from now.
 */
export async function deleteAccount(ctx: Ctx, userId: string): Promise<DeleteAccountResult> {
  const out = await ctx.db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!user) return { status: "deleted" as const, householdsDeleted: 0, phonesRemoved: 0, clientIds: [] };

    const mine = await tx
      .select({ householdId: householdMembers.householdId, role: householdMembers.role })
      .from(householdMembers)
      .where(eq(householdMembers.userId, userId));
    const hids = mine.map((m) => m.householdId);
    // Lock the households (in a fixed order) before counting their members. Two parents
    // deleting at once, or one leaving while the other deletes, then wait for each other
    // instead of both seeing "shared" and leaving a household with no members. A phone
    // claim or invite acceptance into these households waits too (foreign key check).
    if (hids.length) {
      await tx.select({ id: households.id }).from(households).where(inArray(households.id, hids)).orderBy(households.id).for("update");
    }
    const counts = hids.length
      ? await tx
          .select({ hid: householdMembers.householdId, n: sql<number>`count(*)::int` })
          .from(householdMembers)
          .where(inArray(householdMembers.householdId, hids))
          .groupBy(householdMembers.householdId)
      : [];
    const soleHids = counts.filter((c) => c.n <= 1).map((c) => c.hid);
    const sharedOwned = mine.filter((m) => m.role === "owner" && !soleHids.includes(m.householdId));

    const solePhones = soleHids.length
      ? await tx
          .select({ id: phones.id, profile: phones.profile, clientId: phones.dnsClientId })
          .from(phones)
          .where(inArray(phones.householdId, soleHids))
          .for("update")
      : [];
    const selfPhoneIds = solePhones.filter((p) => p.profile === "self").map((p) => p.id);
    if (selfPhoneIds.length) return { status: "blocked" as const, selfPhoneIds };

    // Shared households keep an owner.
    for (const m of sharedOwned) {
      const [next] = await tx
        .select({ userId: householdMembers.userId })
        .from(householdMembers)
        .where(and(eq(householdMembers.householdId, m.householdId), ne(householdMembers.userId, userId)))
        .orderBy(householdMembers.createdAt)
        .limit(1);
      if (next) {
        await tx
          .update(householdMembers)
          .set({ role: "owner" })
          .where(and(eq(householdMembers.householdId, m.householdId), eq(householdMembers.userId, next.userId)));
      }
    }

    // Keys where this user is the trusted person fall back to the delay.
    const keys = await tx
      .update(selfKeys)
      .set({ keyType: "delay", trustedUserId: null, trustedEmail: null })
      .where(sql`${selfKeys.trustedUserId} = ${userId} or ${selfKeys.trustedEmail} = ${user.email}`)
      .returning({ phoneId: selfKeys.phoneId, delayHours: selfKeys.delayHours });
    for (const k of keys) {
      await tx
        .update(pendingChanges)
        .set({ keyType: "delay", effectiveAt: new Date(ctx.now().getTime() + k.delayHours * 3_600_000) })
        .where(
          and(
            eq(pendingChanges.phoneId, k.phoneId),
            eq(pendingChanges.status, "pending"),
            eq(pendingChanges.keyType, "trusted"),
          ),
        );
    }

    // A waiting key change that would make this address someone's trusted person is cancelled:
    // it holds the address, and applied later it would link whoever signs up with it next.
    await tx
      .update(pendingChanges)
      .set({ status: "cancelled", decidedAt: ctx.now() })
      .where(
        and(
          eq(pendingChanges.status, "pending"),
          sql`${pendingChanges.op}->>'type' = 'key.set'`,
          sql`${pendingChanges.op}->'key'->>'trustedEmail' = ${user.email}`,
        ),
      );

    await queueDnsDeletions(
      tx,
      solePhones.map((p) => p.clientId),
    );
    // Cascades to phones and everything stored about them.
    if (soleHids.length) await tx.delete(households).where(inArray(households.id, soleHids));
    await tx.delete(householdInvites).where(eq(householdInvites.email, user.email));
    await tx.delete(magicLinks).where(eq(magicLinks.email, user.email));
    // Cascades to sessions and memberships; requestedBy/decidedBy on changes become null.
    await tx.delete(users).where(eq(users.id, userId));
    return {
      status: "deleted" as const,
      householdsDeleted: soleHids.length,
      phonesRemoved: solePhones.length,
      clientIds: solePhones.map((p) => p.clientId),
    };
  });
  if (out.status === "blocked") return out;
  if (out.clientIds.length) await retryDnsDeletions(ctx, out.clientIds);
  return { status: "deleted", householdsDeleted: out.householdsDeleted, phonesRemoved: out.phonesRemoved };
}
