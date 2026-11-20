// SPDX-License-Identifier: Apache-2.0
import { errorSummary } from "../lib/log.js";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { type DnsCategory, dnsDeletions, dnsSettings, phones } from "../db/schema.js";
import type { Ctx } from "./context.js";

function dnsConfirmationTag(cfg: Ctx["cfg"]): string {
  if (cfg.DNS_PROVIDER === "mock") return "mock";
  // Keep resolver configuration out of the database while invalidating legacy "http" tags.
  const resolver = JSON.stringify([cfg.DNS_API_URL, cfg.DNS_HOST_SUFFIX]);
  return `http:${createHash("sha256").update(resolver).digest("hex")}`;
}

type DnsConfirmation = Pick<typeof phones.$inferSelect, "dnsConfirmedAt" | "dnsConfirmedProvider">;

export function isRulesDnsReady(ctx: Ctx, phone: DnsConfirmation): boolean {
  return phone.dnsConfirmedAt !== null &&
    !(ctx.cfg.DNS_PROVIDER === "http" && phone.dnsConfirmedProvider === "mock");
}

export function isDnsReady(
  ctx: Ctx,
  phone: DnsConfirmation,
): boolean {
  return ctx.cfg.DNS_PROVIDER === "http" &&
    phone.dnsConfirmedAt !== null &&
    phone.dnsConfirmedProvider === dnsConfirmationTag(ctx.cfg);
}

function needsDnsConfirmation(tag: string) {
  return or(isNull(phones.dnsConfirmedAt), sql`${phones.dnsConfirmedProvider} is distinct from ${tag}`);
}

export async function markUnconfirmedDnsDirty(ctx: Ctx): Promise<void> {
  const tag = dnsConfirmationTag(ctx.cfg);
  await ctx.db
    .update(phones)
    .set({ dnsDirty: true })
    .where(and(eq(phones.dnsDirty, false), needsDnsConfirmation(tag)));
}

/**
 * Pushes a phone's DNS rules to the DNS service. On failure the phone stays
 * marked dirty and the sweeper retries; the API call that caused it still succeeds.
 */
export async function syncDns(ctx: Ctx, phoneId: string): Promise<boolean> {
  return (await pushDns(ctx, phoneId)) === "synced";
}

async function pushDns(ctx: Ctx, phoneId: string): Promise<"synced" | "superseded" | "skipped" | "failed"> {
  const tag = dnsConfirmationTag(ctx.cfg);
  const [bumped] = await ctx.db
    .update(phones)
    .set({ dnsDirty: true, dnsVersion: sql`${phones.dnsVersion} + 1` })
    .where(eq(phones.id, phoneId))
    .returning({ version: phones.dnsVersion });
  if (!bumped) return "skipped";
  const [row] = await ctx.db
    .select({ phone: phones, dns: dnsSettings })
    .from(phones)
    .innerJoin(dnsSettings, eq(dnsSettings.phoneId, phones.id))
    .where(eq(phones.id, phoneId));
  if (!row) return "skipped";
  try {
    await ctx.dns.upsertClient({
      clientId: row.phone.dnsClientId,
      profile: row.phone.profile,
      blockedCategories: row.dns.blockedCategories as DnsCategory[],
      allowDomains: row.dns.allowDomains,
      blockDomains: row.dns.blockDomains,
    });
    // Keep the first successful confirmation for this resolver through later failures.
    await ctx.db
      .update(phones)
      .set({ dnsConfirmedAt: ctx.now(), dnsConfirmedProvider: tag })
      .where(and(eq(phones.id, phoneId), needsDnsConfirmation(tag)));
    const [still] = await ctx.db
      .update(phones)
      .set({ dnsDirty: false, rulesAwaitDns: false })
      .where(and(eq(phones.id, phoneId), eq(phones.dnsVersion, bumped.version)))
      .returning({ id: phones.id });
    if (still) return "synced";
    // Another sync started meanwhile. Its upsert may have reached the DNS service before this
    // older one, which then overwrote it with old rules. Bump the version too, so the other sync
    // cannot mark the phone clean either: the sweeper then sends the current rules.
    const [exists] = await ctx.db
      .update(phones)
      .set({ dnsDirty: true, dnsVersion: sql`${phones.dnsVersion} + 1` })
      .where(eq(phones.id, phoneId))
      .returning({ id: phones.id });
    // Removed while the upsert was on its way: make sure the ClientID is forgotten again.
    if (!exists) await queueDnsDeletions(ctx.db, [row.phone.dnsClientId]);
    return "superseded";
  } catch (err) {
    console.error(`DNS sync failed for phone ${phoneId}: ${errorSummary(err)}`);
    return "failed";
  }
}

/** Failed syncs in a row after which the sweeper assumes the DNS service is down. */
const DNS_FAILURES_BEFORE_PAUSE = 3;

/**
 * Retries dirty phones and confirms legacy or previously provisioned phones with the current provider.
 * Stops after a few failures in a row: each can wait out a timeout, and the sweeper's
 * other work (SOS retries, check-in and offline alerts) waits for this one.
 */
export async function syncDirtyDns(ctx: Ctx): Promise<number> {
  await markUnconfirmedDnsDirty(ctx);
  // Random order, so a phone the service keeps refusing cannot hold up the others for good.
  const dirty = await ctx.db
    .select({ id: phones.id })
    .from(phones)
    .where(eq(phones.dnsDirty, true))
    .orderBy(sql`random()`);
  let ok = 0;
  let failures = 0;
  for (const p of dirty) {
    const result = await pushDns(ctx, p.id);
    if (result === "synced") ok++;
    failures = result === "failed" ? failures + 1 : 0;
    if (failures >= DNS_FAILURES_BEFORE_PAUSE) break;
  }
  return ok;
}

type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

/**
 * Records ClientIDs the DNS service must forget. Call it in the transaction that deletes
 * the phones, so a crash or a DNS outage cannot leave a ClientID registered for good.
 */
export async function queueDnsDeletions(db: Ctx["db"] | Tx, clientIds: string[]) {
  if (clientIds.length === 0) return;
  await db
    .insert(dnsDeletions)
    .values(clientIds.map((clientId) => ({ clientId })))
    .onConflictDoNothing();
}

/**
 * Asks the DNS service to delete queued ClientIDs; a row is removed once the service
 * confirms (a 404 counts, since the client is gone either way). Failures stay queued for
 * the next sweep. Returns how many were deleted.
 */
export async function retryDnsDeletions(ctx: Ctx, only?: string[]): Promise<number> {
  const rows = await ctx.db
    .select({ clientId: dnsDeletions.clientId })
    .from(dnsDeletions)
    .where(
      only
        ? inArray(dnsDeletions.clientId, only.length ? only : [""])
        : // Back off: wait 2^attempts minutes (2 … 64) between tries.
          sql`${dnsDeletions.lastAttemptAt} is null or ${dnsDeletions.lastAttemptAt} < ${ctx.now().toISOString()}::timestamptz - make_interval(mins => power(2, least(${dnsDeletions.attempts}, 6))::int)`,
    )
    .orderBy(sql`${dnsDeletions.lastAttemptAt} asc nulls first`)
    .limit(100);
  let done = 0;
  for (const { clientId } of rows) {
    try {
      await ctx.dns.deleteClient(clientId);
      await ctx.db.delete(dnsDeletions).where(eq(dnsDeletions.clientId, clientId));
      done++;
    } catch (err) {
      // The provider's message names the ClientID; log only that it failed.
      void err;
      console.error("DNS delete failed for a removed phone; the sweeper retries");
      await ctx.db
        .update(dnsDeletions)
        .set({ attempts: sql`${dnsDeletions.attempts} + 1`, lastAttemptAt: ctx.now() })
        .where(eq(dnsDeletions.clientId, clientId));
      // The DNS service is probably down: leave the rest for a later sweep instead of
      // waiting for a timeout per row, which would hold up the sweeper's other work.
      break;
    }
  }
  return done;
}
