// SPDX-License-Identifier: Apache-2.0
import { and, eq, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { householdInvites, magicLinks, pairings, pendingChanges, phones, phoneMoves, moveImports, phoneRequests, selfRuleTemplates, sessions } from "../db/schema.js";
import { REQUEST_HISTORY_DAYS } from "./requests.js";
import { applyDueChanges, deletePhone } from "./changes.js";
import type { Ctx } from "./context.js";
import { wakePhone } from "./phones.js";
import { alertUnansweredCheckins, deleteOldSafetyRequests, expireAlwaysLocation } from "./safety.js";
import { PAIRING_RECOVERY_MS } from "./pairing-account.js";
import { retryDnsDeletions, syncDirtyDns } from "./dns.js";
import { alertLiftedOverdue, alertOfflinePhones } from "./notifications.js";
import { deliverSetupUndoNotices } from "./setup-undo-notices.js";
import { errorFrames, errorSummary } from "../lib/log.js";
import { sweepMoreTime } from "./more-time.js";
import { sweepSos } from "./sos.js";
import { sweepQuickMessages } from "./quick-messages.js";
import { sweepSummaries } from "./weekly-summary.js";
import { sweepReviewReminders } from "./age-review.js";

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
  await ctx.db.delete(selfRuleTemplates).where(lt(selfRuleTemplates.expiresAt, now));
  // An imported phone whose move was never finished would stay "awaiting" for good: free it for normal setup.
  // That includes a phone that redeemed its token (it holds a device token) but never synced and so was never
  // activated, for example because the old server changed its rules meanwhile. Dropping the token is safe: the
  // phone never completed a sync with it, and it can be set up again with a new QR code.
  await ctx.db.update(phones).set({ awaitingServerMove: false, deviceTokenHash: null }).where(and(
    eq(phones.awaitingServerMove, true), isNull(phones.pairedAt),
    inArray(phones.id, ctx.db.select({ id: phoneMoves.phoneId }).from(phoneMoves)
      .where(and(eq(phoneMoves.direction, "incoming"), lt(phoneMoves.expiresAt, now)))),
  ));
  await ctx.db.delete(phoneMoves).where(lt(phoneMoves.expiresAt, now));
  await ctx.db.delete(moveImports).where(lt(moveImports.expiresAt, now));
  const applied = await applyDueChanges(ctx);
  // A resolver retry that succeeds changes the rules' ETag for phones that confirmed the
  // "waiting" state: wake them so they fetch and confirm the final one.
  const waitingForDns = (await ctx.db.select({ id: phones.id }).from(phones)
    .where(and(eq(phones.dnsDirty, true), eq(phones.rulesAwaitDns, true)))).map((p) => p.id);
  const dns = await syncDirtyDns(ctx);
  if (waitingForDns.length > 0) {
    const synced = await ctx.db.select({ id: phones.id }).from(phones)
      .where(and(inArray(phones.id, waitingForDns), eq(phones.dnsDirty, false)));
    for (const { id } of synced) await wakePhone(ctx, id, "rules");
  }
  const dnsDeleted = await retryDnsDeletions(ctx);
  // Phones that are silent when they should have reported: out of contact, or a lifted lock step never put back.
  const offlineAlerts = (await alertOfflinePhones(ctx)) + (await alertUnansweredCheckins(ctx)) + (await alertLiftedOverdue(ctx));
  const ended = await expireAlwaysLocation(ctx);
  for (const id of ended) await wakePhone(ctx, id, "rules");
  const dayAgo = new Date(now.getTime() - DAY);
  const count = async (q: Promise<{ count: number }>) => (await q).count;
  const recoveryCutoff = new Date(now.getTime() - PAIRING_RECOVERY_MS);
  const expiredDelivery = lt(pairings.deliveredAt, recoveryCutoff);
  await ctx.db.transaction(async (tx) => {
    const expired = await tx.select({ phoneId: pairings.phoneId }).from(pairings)
      .where(and(eq(pairings.requiresConfirmation, true), isNotNull(pairings.phoneId),
        or(and(isNull(pairings.deliveredAt), lt(pairings.expiresAt, now)),
          and(ne(pairings.mode, "light"), expiredDelivery))))
      .for("update");
    for (const { phoneId } of expired) {
      if (!phoneId) continue;
      const [unconnected] = await tx.select({ id: phones.id }).from(phones)
        .where(and(eq(phones.id, phoneId), isNull(phones.pairedAt))).for("update");
      if (unconnected) await deletePhone(tx, unconnected.id);
    }
  });
  const deleted = {
    magicLinks: await count(expiredMagicLinksDelete(ctx.db, now)),
    sessions: await count(ctx.db.delete(sessions).where(lt(sessions.expiresAt, now))),
    // Expire the recovery code, keeping confirmed light phones available for delayed Undo.
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
  await sweepSos(ctx);
  await sweepQuickMessages(ctx);
  await sweepSummaries(ctx);
  await sweepReviewReminders(ctx);
  await sweepMoreTime(ctx);
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
      console.error(`sweeper failed: ${errorSummary(err)}\n${errorFrames(err)}`);
    } finally {
      running = false;
    }
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
