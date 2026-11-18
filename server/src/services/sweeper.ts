// SPDX-License-Identifier: Apache-2.0
import { and, eq, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { householdInvites, magicLinks, pairings, pendingChanges, phones, phoneRequests, sessions } from "../db/schema.js";
import { REQUEST_HISTORY_DAYS } from "./requests.js";
import { applyDueChanges, deletePhone } from "./changes.js";
import type { Ctx } from "./context.js";
import { wakePhone } from "./phones.js";
import { alertUnansweredCheckins, deleteOldSafetyRequests, expireAlwaysLocation } from "./safety.js";
import { PAIRING_RECOVERY_MS, SETUP_UNDO_WINDOW_MS } from "./pairing-account.js";
import { retryDnsDeletions, syncDirtyDns } from "./dns.js";
import { alertOfflinePhones } from "./notifications.js";
import { deliverSetupUndoNotices } from "./setup-undo-notices.js";

const DAY = 86_400_000;
/** Expired invitations are kept this long, so "this invitation has expired" can still be shown. */
export const INVITE_GRACE_DAYS = 1;
/** Finished pending changes (applied, cancelled, rejected, failed) are kept this long as history. */
export const CHANGE_HISTORY_DAYS = 30;

export interface SweepResult {
  applied: number;
  dns: number;
  dnsDeleted: number;
  offlineAlerts: number;
  /** Phones whose time-boxed "always" location ended. */
  alwaysEnded: number;
  deleted: { magicLinks: number; sessions: number; pairings: number; invites: number; changes: number; requests: number; safety: number };
}

export function expiredMagicLinksDelete(db: Ctx["db"], now: Date) {
  return db.delete(magicLinks).where(lt(magicLinks.expiresAt, new Date(now.getTime() - DAY)));
}

/** One pass of background work: due delay-key changes, DNS retries, expired rows. */
export async function sweep(ctx: Ctx): Promise<SweepResult> {
  const now = ctx.now();
  const applied = await applyDueChanges(ctx);
  const dns = await syncDirtyDns(ctx);
  const dnsDeleted = await retryDnsDeletions(ctx);
  const offlineAlerts = (await alertOfflinePhones(ctx)) + (await alertUnansweredCheckins(ctx));
  const ended = await expireAlwaysLocation(ctx);
  for (const id of ended) await wakePhone(ctx, id, "rules");
  const dayAgo = new Date(now.getTime() - DAY);
  const count = async (q: Promise<{ count: number }>) => (await q).count;
  const recoveryCutoff = new Date(now.getTime() - PAIRING_RECOVERY_MS);
  const undoCutoff = new Date(now.getTime() - SETUP_UNDO_WINDOW_MS);
  const expiredDelivery = or(
    lt(pairings.deliveredAt, undoCutoff),
    and(lt(pairings.deliveredAt, recoveryCutoff), or(eq(pairings.requiresConfirmation, false), ne(pairings.mode, "light"))),
  );
  await ctx.db.transaction(async (tx) => {
    const expired = await tx.select({ phoneId: pairings.phoneId }).from(pairings)
      .where(and(eq(pairings.requiresConfirmation, true), isNotNull(pairings.phoneId),
        or(and(isNull(pairings.deliveredAt), lt(pairings.expiresAt, now)), expiredDelivery)))
      .for("update");
    for (const { phoneId } of expired) {
      if (!phoneId) continue;
      const [unconnected] = await tx.select({ id: phones.id }).from(phones)
        .where(and(eq(phones.id, phoneId), isNull(phones.pairedAt))).for("update");
      if (unconnected) await deletePhone(tx, unconnected.id);
    }
    // Keep light-mode delivery timestamps for Undo after token recovery expires.
    await tx.update(pairings).set({ pendingDeviceToken: null })
      .where(and(eq(pairings.requiresConfirmation, true), eq(pairings.mode, "light"),
        lt(pairings.deliveredAt, recoveryCutoff), isNotNull(pairings.pendingDeviceToken)));
  });
  const deleted = {
    magicLinks: await count(expiredMagicLinksDelete(ctx.db, now)),
    sessions: await count(ctx.db.delete(sessions).where(lt(sessions.expiresAt, now))),
    // Pairings may retain a device token until the phone first syncs or recovery expires.
    pairings: await count(
      ctx.db
        .delete(pairings)
        .where(or(expiredDelivery, and(isNull(pairings.deliveredAt), lt(pairings.expiresAt, dayAgo)))),
    ),
    // Invitations hold the invited email address. Accepted ones are deleted on acceptance;
    // this also catches any left from before that.
    invites: await count(
      ctx.db
        .delete(householdInvites)
        .where(
          or(
            isNotNull(householdInvites.acceptedAt),
            lt(householdInvites.expiresAt, new Date(now.getTime() - INVITE_GRACE_DAYS * DAY)),
          ),
        ),
    ),
    // A change's op can hold contact names and numbers, domains or an email address.
    changes: await count(
      ctx.db
        .delete(pendingChanges)
        .where(
          and(
            inArray(pendingChanges.status, ["applied", "cancelled", "rejected", "failed"]),
            lt(pendingChanges.decidedAt, new Date(now.getTime() - CHANGE_HISTORY_DAYS * DAY)),
          ),
        ),
    ),
    // Answered requests hold an app name or a contact; the phone shows the answer for a while.
    requests: await count(
      ctx.db
        .delete(phoneRequests)
        .where(
          and(
            inArray(phoneRequests.status, ["approved", "rejected"]),
            lt(phoneRequests.decidedAt, new Date(now.getTime() - REQUEST_HISTORY_DAYS * DAY)),
          ),
        ),
    ),
    // Rings and "Are you okay?" requests, a day after they ended.
    safety: await deleteOldSafetyRequests(ctx),
  };
  await deliverSetupUndoNotices(ctx);
  return { applied, dns, dnsDeleted, offlineAlerts, alwaysEnded: ended.length, deleted };
}

/** Logs only counts, never ids or addresses, and only when something happened. */
export function logSweep(r: SweepResult, always = false) {
  const d = r.deleted;
  const total = r.applied + r.dnsDeleted + r.offlineAlerts + r.alwaysEnded + d.magicLinks + d.sessions + d.pairings + d.invites + d.changes + d.requests + d.safety;
  if (total === 0 && !always) return;
  console.log(
    `sweeper: applied=${r.applied} dnsSynced=${r.dns} dnsDeleted=${r.dnsDeleted} offlineAlerts=${r.offlineAlerts} alwaysEnded=${r.alwaysEnded} deleted magicLinks=${d.magicLinks} sessions=${d.sessions} pairings=${d.pairings} invites=${d.invites} changes=${d.changes} requests=${d.requests} safety=${d.safety}`,
  );
}

export function startSweeper(ctx: Ctx, everyMs = 60_000): () => void {
  let running = false;
  let first = true;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      // The first pass always logs, so a deploy shows that the sweeper runs.
      logSweep(await sweep(ctx), first);
      first = false;
    } catch (err) {
      console.error("sweeper failed", err);
    } finally {
      running = false;
    }
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
