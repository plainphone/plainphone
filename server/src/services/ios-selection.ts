// SPDX-License-Identifier: Apache-2.0
//
// iPhone app selections (docs/ios/architecture.md, "App selections"): Apple's encoded
// FamilyActivitySelection, stored per phone as an opaque blob. Where it may be picked comes from
// the capability map: `pickAppsOnParent` (the parent's own iPhone) and `pickAppsOnPhone` (the
// child's iPhone after the parent PIN). Spike (a) decides which one phase 1 uses.

import { eq } from "drizzle-orm";
import { iosSelections, phones, IOS_SELECTION_SOURCES } from "../db/schema.js";
import { capabilities, phoneTier, type Feature } from "../lib/capabilities.js";
import type { Ctx } from "./context.js";
export { loadIosSelection } from "./ios-rules.js";
import { nextRulesRevision, wakePhone } from "./phones.js";

type Phone = typeof phones.$inferSelect;
export type IosSelectionSource = (typeof IOS_SELECTION_SOURCES)[number];

const FEATURE: Record<IosSelectionSource, Feature> = { parent: "pickAppsOnParent", phone: "pickAppsOnPhone" };

/** Whether this phone's platform and tier let `source` pick its apps. */
export function canPickApps(phone: Pick<Phone, "platform" | "mode" | "iosTier">, source: IosSelectionSource): boolean {
  return capabilities(phoneTier(phone))[FEATURE[source]] !== "no";
}

/**
 * Store a selection. From the parent it is a rule change: the phone gets a new rules revision and
 * a wake-up. From the phone it already happened there (after the parent PIN): the server records it.
 */
export async function saveIosSelection(ctx: Ctx, phone: Phone, selection: string, source: IosSelectionSource, userId: string | null) {
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    await tx.insert(iosSelections)
      .values({ phoneId: phone.id, selection, source, updatedBy: userId, updatedAt: now })
      .onConflictDoUpdate({
        target: iosSelections.phoneId,
        set: { selection, source, updatedBy: userId, updatedAt: now },
      });
    if (source === "parent") await tx.update(phones).set(nextRulesRevision()).where(eq(phones.id, phone.id));
  });
  if (source === "parent") await wakePhone(ctx, phone.id, "rules");
  return { source, updatedAt: now.toISOString() };
}
