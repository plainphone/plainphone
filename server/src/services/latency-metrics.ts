// SPDX-License-Identifier: Apache-2.0
//
// The operator's view of delivery speed (docs/latency.md): p50, p95 and sample counts per path and
// provider over 1 h and 24 h, plus push failures per provider, as Prometheus text. Aggregates only:
// the labels are path, provider, kind and window, so no household, phone or user can be told apart.

import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { latencySamples } from "../db/schema.js";
import type { Ctx } from "./context.js";
import { latencyOn } from "./latency.js";

const HOUR = 3_600_000;
/** Samples carry their hour, rounded down, so a window reaches back to the start of the hour it begins in. */
export const METRIC_WINDOWS = [{ label: "1h", hours: 1 }, { label: "24h", hours: 24 }] as const;

/** Provider names as the operator knows them (the table says `web`; the push standard says Web Push). */
const providerName = (p: string | null) => (p === "web" ? "webpush" : p);

const failures = new WeakMap<Ctx, Map<string, number>>();
const PUSH_PROVIDERS = ["fcm", "apns", "unifiedpush", "webpush"];

/** Counts one failed push, to a parent or a wake-up to a child phone (not a gone subscription). A counter since start-up: Prometheus copes with the reset. */
export function countPushFailure(ctx: Ctx, platform: string) {
  if (!latencyOn(ctx)) return;
  const counts = failures.get(ctx) ?? new Map<string, number>();
  failures.set(ctx, counts);
  const provider = providerName(platform) ?? platform;
  counts.set(provider, (counts.get(provider) ?? 0) + 1);
}

interface Row { path: string; provider: string | null; kind: string | null; window: string; samples: number; p50: number; p95: number }

async function windowRows(ctx: Ctx, label: string, hours: number): Promise<Row[]> {
  const s = latencySamples;
  const since = new Date(Math.floor((ctx.now().getTime() - hours * HOUR) / HOUR) * HOUR);
  const stats = (value: ReturnType<typeof sql>) => ({
    samples: sql<number>`count(*)::int`,
    p50: sql<number>`round(percentile_cont(0.5) within group (order by ${value}))::int`,
    p95: sql<number>`round(percentile_cont(0.95) within group (order by ${value}))::int`,
  });
  const kind = sql<string | null>`case when ${s.path} = 'phone-server' then ${s.kind} end`;
  const window = and(gte(s.hour, since), isNotNull(s.ms));
  const [legs, endToEnd] = await Promise.all([
    ctx.db.select({ path: s.path, provider: s.provider, kind, ...stats(sql`${s.ms}`) })
      .from(s).where(window).groupBy(s.path, s.provider, kind),
    ctx.db.select({ provider: s.provider, ...stats(sql`${s.ms} + ${s.deliveredMs}`) })
      .from(s).where(and(window, eq(s.path, "server-parent"), isNotNull(s.deliveredMs))).groupBy(s.provider),
  ]);
  return [
    ...legs.map((r): Row => ({ ...r, kind: r.kind ?? null, window: label })),
    ...endToEnd.map((r): Row => ({ path: "parent-device", kind: null, window: label, ...r })),
  ];
}

const escape = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
const labels = (l: Record<string, string | null>) =>
  `{${Object.entries(l).filter(([, v]) => v !== null).map(([k, v]) => `${k}="${escape(v!)}"`).join(",")}}`;

/** The metrics page. Empty groups are left out; the failure counters always show, at 0 when nothing failed. */
export async function metricsText(ctx: Ctx): Promise<string> {
  const rows = latencyOn(ctx) ? (await Promise.all(METRIC_WINDOWS.map((w) => windowRows(ctx, w.label, w.hours)))).flat() : [];
  rows.sort((a, b) => a.window.localeCompare(b.window) || a.path.localeCompare(b.path)
    || String(a.provider).localeCompare(String(b.provider)) || String(a.kind).localeCompare(String(b.kind)));
  const out = [
    "# HELP plainphone_latency_ms Delivery time in milliseconds per path (phone-server, server-parent, parent-device, server-child), provider and window.",
    "# TYPE plainphone_latency_ms gauge",
  ];
  const id = (r: Row) => ({ path: r.path, provider: providerName(r.provider), kind: r.kind, window: r.window });
  for (const r of rows) {
    out.push(`plainphone_latency_ms${labels({ ...id(r), quantile: "0.5" })} ${r.p50}`);
    out.push(`plainphone_latency_ms${labels({ ...id(r), quantile: "0.95" })} ${r.p95}`);
  }
  out.push("# HELP plainphone_latency_samples Timings behind the numbers above, per path, provider and window.",
    "# TYPE plainphone_latency_samples gauge");
  for (const r of rows) out.push(`plainphone_latency_samples${labels(id(r))} ${r.samples}`);
  out.push("# HELP plainphone_push_failures_total Parent pushes that failed since the server started, per provider.",
    "# TYPE plainphone_push_failures_total counter");
  const counts = failures.get(ctx);
  const names = [...new Set([...PUSH_PROVIDERS, ...(counts?.keys() ?? [])])].sort();
  for (const p of names) out.push(`plainphone_push_failures_total${labels({ provider: p })} ${counts?.get(p) ?? 0}`);
  return `${out.join("\n")}\n`;
}
