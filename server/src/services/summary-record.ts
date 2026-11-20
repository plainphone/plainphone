// SPDX-License-Identifier: Apache-2.0
//
// What the weekly summary is built from, written as it happens (docs/weekly-summary.md).

import { errorSummary } from "../lib/log.js";
import { sql } from "drizzle-orm";
import { phoneUsageDays, summaryEvents } from "../db/schema.js";
import type { ChangeCategory } from "../lib/summary-text.js";
import type { Op } from "./changes.js";
import type { Ctx } from "./context.js";
import { localDate } from "./limits.js";

type Db = Ctx["db"] | Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

export function changeCategory(op: Pick<Op, "type">): ChangeCategory {
  const t = op.type;
  if (t.startsWith("timeLimit")) return "time";
  if (t.startsWith("app.") || t.startsWith("catalog.") || t.startsWith("openMode")) return "apps";
  if (t.startsWith("contact.")) return "contacts";
  if (t.startsWith("dns.")) return "web";
  if (t.startsWith("schedule.")) return "schedules";
  return "other";
}

/** Keeps the highest reading per phone, day and package: use only grows during a day. */
export async function recordUsage(
  db: Db,
  phone: { id: string; timezone: string; weeklySummaryEnabled: boolean },
  timeUsed: Record<string, number> | undefined,
  now: Date,
): Promise<void> {
  if (!phone.weeklySummaryEnabled || !timeUsed) return;
  const entries = Object.entries(timeUsed);
  if (entries.length === 0) return;
  const day = localDate(phone.timezone, now);
  await db
    .insert(phoneUsageDays)
    .values(entries.map(([packageName, minutes]) => ({ phoneId: phone.id, day, packageName, minutes })))
    .onConflictDoUpdate({
      target: [phoneUsageDays.phoneId, phoneUsageDays.day, phoneUsageDays.packageName],
      set: { minutes: sql`greatest(${phoneUsageDays.minutes}, excluded.minutes)` },
    });
}

/** Notes news for the summary. Never throws: the news itself must still go out. The insert runs in a
 * savepoint, so a failed insert cannot abort a surrounding transaction. */
export async function recordSummaryEvent(
  db: Db,
  phoneId: string,
  kind: "protection" | "offline" | "checkin" | "change",
  at: Date,
  detail?: string,
): Promise<void> {
  try {
    await db.transaction((sp) => sp.insert(summaryEvents).values({ phoneId, kind, at, detail: detail ?? null }));
  } catch (err) {
    console.error(`summary event not recorded: ${errorSummary(err)}`);
  }
}
