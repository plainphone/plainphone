// SPDX-License-Identifier: Apache-2.0
import { and, eq, gt, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { pushSubscriptions, sessions, setupUndoNotices } from "../db/schema.js";
import { sha256 } from "../lib/crypto.js";
import type { Ctx } from "./context.js";

type Subscription = typeof pushSubscriptions.$inferSelect;
type NativeRegistration = {
  platform: "fcm" | "apns";
  token: string;
  installationKey?: string;
  subscriptionId?: string;
  optIn?: boolean;
  label?: string;
  replaces?: string;
};

export async function registerNativeSubscription(
  ctx: Ctx, userId: string, sessionId: string, input: NativeRegistration,
) {
  const installationHash = input.installationKey ? sha256(input.installationKey) : null;
  return ctx.db.transaction(async (tx) => {
    // A logout that wins this lock prevents registration; one that follows cascades to the new row.
    const [session] = await tx.select({ id: sessions.id }).from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), gt(sessions.expiresAt, ctx.now())))
      .for("key share");
    if (!session) return { status: 401, error: "sign in first" } as const;
    if (installationHash) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${installationHash}, 0))`);
    }

    let existing: Subscription | undefined;
    if (installationHash) {
      [existing] = await tx.select().from(pushSubscriptions)
        .where(eq(pushSubscriptions.installationHash, installationHash)).for("update");
    }
    if (!existing && input.subscriptionId) {
      [existing] = await tx.select().from(pushSubscriptions).where(and(
        eq(pushSubscriptions.id, input.subscriptionId), eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.platform, input.platform),
      )).for("update");
      if (existing?.installationHash && existing.installationHash !== installationHash) {
        return { status: 404, error: "subscription removed" } as const;
      }
      // Modern clients can carry an old ID after logout or provider cleanup.
      if (!existing && !installationHash) return { status: 404, error: "subscription removed" } as const;
    }
    if (!existing) {
      [existing] = await tx.select().from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, input.token)).for("update");
      // A reinstall may keep its token under a new installation key, so an active row is taken over.
      // Revoked and gone rows are handled by the state checks below.
      if (existing && existing.platform !== input.platform) {
        return { status: 404, error: "subscription removed" } as const;
      }
    }
    if ((existing?.state === "revoked" && !input.optIn) ||
        (existing?.state === "gone" && existing.endpoint === input.token)) {
      return { status: 404, error: "subscription removed" } as const;
    }

    const values = {
      userId, sessionId, installationHash, platform: input.platform,
      endpoint: input.token, label: input.label ?? existing?.label ?? null,
      state: "active" as const, failures: 0,
      lastSuccessAt: existing?.userId === userId ? existing.lastSuccessAt : null,
    };
    if (existing && existing.userId !== userId) {
      await tx.delete(setupUndoNotices).where(eq(setupUndoNotices.subscriptionId, existing.id));
    }
    const [row] = existing
      ? await tx.update(pushSubscriptions).set(values).where(eq(pushSubscriptions.id, existing.id)).returning()
      : await tx.insert(pushSubscriptions).values(values).onConflictDoNothing().returning();
    if (!row) return { status: 409, error: "registration changed, retry" } as const;

    if (input.replaces && input.replaces !== input.token) {
      await tx.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.platform, input.platform), eq(pushSubscriptions.endpoint, input.replaces),
        eq(pushSubscriptions.state, "active")));
    }
    return { status: 201, row } as const;
  });
}

export async function removePushSubscription(ctx: Ctx, userId: string, id: string) {
  await ctx.db.transaction(async (tx) => {
    const owned = and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.id, id));
    const [revoked] = await tx.update(pushSubscriptions).set({ state: "revoked", sessionId: null })
      .where(and(owned, ne(pushSubscriptions.platform, "web"))).returning({ id: pushSubscriptions.id });
    if (revoked) {
      await tx.delete(setupUndoNotices).where(eq(setupUndoNotices.subscriptionId, revoked.id));
    } else {
      await tx.delete(pushSubscriptions).where(and(owned, eq(pushSubscriptions.platform, "web")));
    }
  });
}

export function deliverablePushSubscription() {
  return and(eq(pushSubscriptions.state, "active"),
    or(eq(pushSubscriptions.platform, "web"), isNotNull(pushSubscriptions.sessionId)));
}

export function samePushRegistration(sub: Subscription) {
  return and(eq(pushSubscriptions.id, sub.id), eq(pushSubscriptions.userId, sub.userId),
    eq(pushSubscriptions.endpoint, sub.endpoint), eq(pushSubscriptions.state, "active"),
    sub.sessionId ? eq(pushSubscriptions.sessionId, sub.sessionId) : isNull(pushSubscriptions.sessionId));
}

export async function discardGonePushSubscription(ctx: Ctx, sub: Subscription) {
  const matched = samePushRegistration(sub);
  if (sub.platform === "web") {
    await ctx.db.delete(pushSubscriptions).where(matched);
  } else {
    await ctx.db.update(pushSubscriptions).set({ state: "gone", sessionId: null }).where(matched);
  }
}
