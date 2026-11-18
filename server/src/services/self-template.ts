// SPDX-License-Identifier: Apache-2.0
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { DNS_CATEGORIES, dnsSettings, phoneApps, phones, schedules, selfRuleTemplates, timeLimits } from "../db/schema.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { packageName, scheduleInput } from "../lib/validation.js";
import { limitInput, limitTarget } from "./limits.js";
import type { Ctx } from "./context.js";

export const templateCode = z.string().regex(/^pp_r_[A-Za-z0-9_-]{30,70}$/);
const templateRules = z.object({
  apps: z.array(z.object({ packageName, allowed: z.boolean() })).max(1000),
  schedules: z.array(scheduleInput).max(200),
  limits: z.array(limitInput.extend({ packageName: limitTarget })).max(1000),
  blockedCategories: z.array(z.enum(DNS_CATEGORIES)),
});
type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

export async function shareSelfTemplate(ctx: Ctx, phone: typeof phones.$inferSelect) {
  if (phone.profile !== "self" || !phone.pairedAt) return null;
  return ctx.db.transaction(async (tx) => {
    const [fresh] = await tx.select({ id: phones.id }).from(phones).where(eq(phones.id, phone.id)).for("update");
    if (!fresh) return null;
    const apps = await tx.select({ packageName: phoneApps.packageName, allowed: phoneApps.allowed })
      .from(phoneApps).where(and(eq(phoneApps.phoneId, phone.id), eq(phoneApps.core, false)));
    const windows = await tx.select({
      kind: schedules.kind, days: schedules.days, startMinute: schedules.startMinute,
      endMinute: schedules.endMinute, allowedPackages: schedules.allowedPackages,
    }).from(schedules).where(eq(schedules.phoneId, phone.id));
    const limits = await tx.select({ packageName: timeLimits.packageName, minutes: timeLimits.minutes, days: timeLimits.days })
      .from(timeLimits).where(eq(timeLimits.phoneId, phone.id));
    const [dns] = await tx.select({ blockedCategories: dnsSettings.blockedCategories }).from(dnsSettings)
      .where(eq(dnsSettings.phoneId, phone.id));
    const rules = templateRules.safeParse({ apps, schedules: windows, limits, blockedCategories: dns?.blockedCategories ?? [] });
    if (!rules.success) return null;
    const code = randomToken("pp_r_");
    await tx.insert(selfRuleTemplates).values({
      tokenHash: sha256(code), rules: rules.data, expiresAt: new Date(ctx.now().getTime() + 15 * 60_000),
    });
    return { url: `${ctx.cfg.PUBLIC_URL.replace(/\/$/, "")}/add#template=${code}` };
  });
}

export async function readSelfTemplate(tx: Tx, code: string, now: Date) {
  const [row] = await tx.select({ rules: selfRuleTemplates.rules }).from(selfRuleTemplates)
    .where(and(eq(selfRuleTemplates.tokenHash, sha256(code)), gt(selfRuleTemplates.expiresAt, now)));
  return row ? templateRules.parse(row.rules) : null;
}

export async function applySelfTemplate(tx: Tx, phoneId: string, rules: z.infer<typeof templateRules>, now: Date) {
  if (rules.apps.length) {
    await tx.insert(phoneApps).values(rules.apps.map((app) => ({
      ...app, phoneId, label: app.packageName, installed: false, reportedAt: now,
    })));
  }
  if (rules.schedules.length) await tx.insert(schedules).values(rules.schedules.map((rule) => ({ ...rule, phoneId })));
  if (rules.limits.length) await tx.insert(timeLimits).values(rules.limits.map((rule) => ({ ...rule, phoneId })));
  await tx.update(dnsSettings).set({ blockedCategories: rules.blockedCategories }).where(eq(dnsSettings.phoneId, phoneId));
}
