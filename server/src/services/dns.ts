// SPDX-License-Identifier: Apache-2.0
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { type DnsCategory, dnsDeletions, dnsSettings, phones } from "../db/schema.js";
import type { Ctx } from "./context.js";

/**
 * Pushes a phone's DNS rules to the DNS service. On failure the phone stays
 * marked dirty and the sweeper retries; the API call that caused it still succeeds.
 */
export async function syncDns(ctx: Ctx, phoneId: string): Promise<boolean> {
  const [bumped] = await ctx.db
    .update(phones)
    .set({ dnsDirty: true, dnsVersion: sql`${phones.dnsVersion} + 1` })
    .where(eq(phones.id, phoneId))
    .returning({ version: phones.dnsVersion });
  if (!bumped) return false;
  const [row] = await ctx.db
    .select({ phone: phones, dns: dnsSettings })
    .from(phones)
    .innerJoin(dnsSettings, eq(dnsSettings.phoneId, phones.id))
    .where(eq(phones.id, phoneId));
  if (!row) return false;
  try {
    await ctx.dns.upsertClient({
      clientId: row.phone.dnsClientId,
      profile: row.phone.profile,
      blockedCategories: row.dns.blockedCategories as DnsCategory[],
      allowDomains: row.dns.allowDomains,
      blockDomains: row.dns.blockDomains,
    });
    // The DNS service knows this ClientID now. Record that once and never take it back, so a
    // later failed sync cannot make a phone that already uses its private DNS look unregistered.
    await ctx.db
      .update(phones)
      .set({ dnsConfirmedAt: ctx.now() })
      .where(and(eq(phones.id, phoneId), isNull(phones.dnsConfirmedAt)));
    const [still] = await ctx.db
      .update(phones)
      .set({ dnsDirty: false })
      .where(and(eq(phones.id, phoneId), eq(phones.dnsVersion, bumped.version)))
      .returning({ id: phones.id });
    if (!still) {
      // Removed while the upsert was on its way: make sure the ClientID is forgotten again.
      const [exists] = await ctx.db.select({ id: phones.id }).from(phones).where(eq(phones.id, phoneId));
      if (!exists) await queueDnsDeletions(ctx.db, [row.phone.dnsClientId]);
    }
    return true;
  } catch (err) {
    console.error(`DNS sync failed for phone ${phoneId}: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Retries phones whose rules the DNS service has not received, and syncs phones that were
 * last synced before `dnsConfirmedAt` existed so they too become ready.
 */
export async function syncDirtyDns(ctx: Ctx): Promise<number> {
  const dirty = await ctx.db
    .select({ id: phones.id })
    .from(phones)
    .where(or(eq(phones.dnsDirty, true), isNull(phones.dnsConfirmedAt)));
  let ok = 0;
  for (const p of dirty) if (await syncDns(ctx, p.id)) ok++;
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
    .where(only ? inArray(dnsDeletions.clientId, only.length ? only : [""]) : undefined)
    .orderBy(sql`${dnsDeletions.lastAttemptAt} asc nulls first`)
    .limit(100);
  let done = 0;
  for (const { clientId } of rows) {
    try {
      await ctx.dns.deleteClient(clientId);
      await ctx.db.delete(dnsDeletions).where(eq(dnsDeletions.clientId, clientId));
      done++;
    } catch (err) {
      console.error(`DNS delete failed for a removed phone, will retry: ${(err as Error).message}`);
      await ctx.db
        .update(dnsDeletions)
        .set({ attempts: sql`${dnsDeletions.attempts} + 1`, lastAttemptAt: ctx.now() })
        .where(eq(dnsDeletions.clientId, clientId));
    }
  }
  return done;
}
