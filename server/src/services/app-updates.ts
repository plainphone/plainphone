// SPDX-License-Identifier: Apache-2.0
//
// App updates in strong mode (docs/policies.md, "App updates"). The phone opens a bounded window
// at night or on "Update apps now" in which Play may update approved apps. A new app installed
// during the window is hidden on the phone at once; here it becomes a request for the parents.
// The phone is the authority for what happened: a report is always recorded, never rejected.

import { and, eq } from "drizzle-orm";
import { type AppUpdateWindowReport, phoneApps, phones } from "../db/schema.js";
import type { Ctx } from "./context.js";
import { nextRulesRevision, wakePhone } from "./phones.js";
import { createRequest, RequestError } from "./requests.js";

type Phone = typeof phones.$inferSelect;

/** Apps of [report] the server has not turned into requests yet; the same window can catch more later. */
function unrecorded(phone: Phone, report: AppUpdateWindowReport): string[] {
  const seen = phone.appUpdatesReportedWindow === report.id ? new Set(phone.appUpdatesRecordedApps) : new Set<string>();
  return [...new Set(report.caught)].filter((p) => !seen.has(p));
}

/**
 * Turns the new apps a window caught into app requests, once per app and window. In open mode,
 * where new apps are allowed by default, they are blocked until a parent approves the request.
 * Then the rules list the recorded apps, so the phone stops holding exactly those back itself.
 * An app the phone held back from an earlier window rides along in a later report.
 */
export async function recordAppUpdateWindow(ctx: Ctx, phone: Phone, report: AppUpdateWindowReport | undefined) {
  if (!report || unrecorded(phone, report).length === 0) return;
  const toRequest = await ctx.db.transaction(async (tx) => {
    const [fresh] = await tx.select().from(phones).where(eq(phones.id, phone.id)).for("update");
    if (!fresh) return null;
    const fresher = unrecorded(fresh, report);
    if (fresher.length === 0) return null;
    const recorded = fresh.appUpdatesReportedWindow === report.id ? fresh.appUpdatesRecordedApps : [];
    const out: string[] = [];
    for (const packageName of fresher) {
      const [app] = await tx.select().from(phoneApps)
        .where(and(eq(phoneApps.phoneId, phone.id), eq(phoneApps.packageName, packageName)));
      if (!app) {
        // The app list has not reached the server yet: the package name stands in for the label.
        await tx.insert(phoneApps).values({
          phoneId: phone.id, packageName, label: packageName, allowed: false, explicitlyBlocked: fresh.openMode,
        }).onConflictDoNothing();
        out.push(packageName);
      } else if (!app.core && !app.allowed) {
        if (fresh.openMode && !app.explicitlyBlocked) {
          await tx.update(phoneApps).set({ explicitlyBlocked: true, installed: true })
            .where(and(eq(phoneApps.phoneId, phone.id), eq(phoneApps.packageName, packageName)));
        } else if (!app.installed) {
          await tx.update(phoneApps).set({ installed: true })
            .where(and(eq(phoneApps.phoneId, phone.id), eq(phoneApps.packageName, packageName)));
        }
        out.push(packageName);
      }
      // An app the parents allowed before (installed again) stays allowed.
    }
    await tx.update(phones).set({
      appUpdatesReportedWindow: report.id,
      appUpdatesRecordedApps: [...recorded, ...fresher].sort(),
      ...nextRulesRevision(),
    }).where(eq(phones.id, phone.id));
    return out;
  });
  if (toRequest === null) return;
  for (const packageName of toRequest) {
    try {
      await createRequest(ctx, phone, { kind: "app", packageName });
    } catch (e) {
      // Too many open requests, or already allowed meanwhile: the app is still on the list, hidden.
      if (!(e instanceof RequestError)) throw e;
    }
  }
  await wakePhone(ctx, phone.id, "rules");
}
