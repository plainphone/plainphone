// SPDX-License-Identifier: Apache-2.0
import { and, eq, sql } from "drizzle-orm";
import { type DnsCategory, dnsSettings, phones } from "../db/schema.js";
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
    await ctx.db
      .update(phones)
      .set({ dnsDirty: false })
      .where(and(eq(phones.id, phoneId), eq(phones.dnsVersion, bumped.version)));
    return true;
  } catch (err) {
    console.error(`DNS sync failed for phone ${phoneId}: ${(err as Error).message}`);
    return false;
  }
}

export async function syncDirtyDns(ctx: Ctx): Promise<number> {
  const dirty = await ctx.db
    .select({ id: phones.id })
    .from(phones)
    .where(eq(phones.dnsDirty, true));
  let ok = 0;
  for (const p of dirty) if (await syncDns(ctx, p.id)) ok++;
  return ok;
}
