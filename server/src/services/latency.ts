// SPDX-License-Identifier: Apache-2.0
//
// How long alerts and wake-ups take, per path and provider (docs/latency.md). Only durations,
// provider names and a coarse hour are kept; never content, a user or (once a wake-up is answered)
// a phone. Recording never fails or slows the thing it measures: every write is best effort.

import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { latencySamples } from "../db/schema.js";
import { errorSummary } from "../lib/log.js";
import type { PushClass } from "../lib/push-priority.js";
import type { WakeReason } from "../providers/push.js";
import type { Ctx } from "./context.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The window the stats cover. */
export const LATENCY_WINDOW_DAYS = 7;
/** Rows are kept one day longer than the window, so the window is always full. */
const KEEP_DAYS = LATENCY_WINDOW_DAYS + 1;
/** A receipt arriving later than this is not a delivery time any more; the id is dropped. */
const RECEIPT_DAYS = 1;
/** Fewer samples than this are not shown: too few to mean anything, and too close to a single event. */
export const MIN_SAMPLES = 5;
/** Longest believable phone-side delay (an SOS queued offline for a month is still a report, not a timing). */
const MAX_UPLOAD_MS = DAY;

export const latencyOn = (ctx: Ctx) => ctx.cfg.LATENCY_STATS !== "off";
const hourOf = (d: Date) => new Date(Math.floor(d.getTime() / HOUR) * HOUR);
const quietly = (what: string) => (err: unknown) => console.error(`latency ${what} failed: ${errorSummary(err)}`);

/** Milliseconds from `anchor` to now, in SQL, never negative; 0 when there is no anchor yet. */
const sinceAnchor = (now: Date) => sql<number>`greatest(0, least(2147483647,
  round(extract(epoch from (${now.toISOString()}::timestamptz - coalesce(${latencySamples.anchorAt}, ${now.toISOString()}::timestamptz))) * 1000)))::int`;

/**
 * The phone's upload of an SOS or quick message: from the press to the server. `elapsedMs` is the
 * phone's own monotonic clock (no clock skew); without it the phone's wall clock `sentAt` is used.
 */
export function recordUpload(ctx: Ctx, kind: "sos" | "quick", elapsedMs: number | undefined, sentAt: Date | undefined) {
  if (!latencyOn(ctx)) return;
  const now = ctx.now();
  const ms = elapsedMs ?? (sentAt ? now.getTime() - sentAt.getTime() : undefined);
  if (ms === undefined || !Number.isFinite(ms) || ms < 0 || ms > MAX_UPLOAD_MS) return;
  void ctx.db.insert(latencySamples).values({ path: "phone-server", kind, hour: hourOf(now), ms: Math.round(ms) })
    .catch(quietly("upload"));
}

/** The `X-Plainphone-Elapsed-Ms` header: a header, so older servers simply ignore it. */
export function elapsedHeader(value: string | undefined): number | undefined {
  if (!value || !/^\d{1,10}$/.test(value)) return undefined;
  return Number(value);
}

export interface ParentSample {
  /** Goes into the push as `receipt`. */
  receipt: string;
  /** Records the time from `origin` to the push service accepting it, or forgets the sample. */
  settle(sent: boolean, origin: Date): Promise<void>;
}

/**
 * Starts timing one parent push. The row is written while the push goes out, not before, so the
 * alert never waits for it. A receipt that beats the row's update counts as delivered at once.
 */
export function parentSample(ctx: Ctx, provider: string, cls: PushClass): ParentSample | undefined {
  if (!latencyOn(ctx)) return undefined;
  const id = randomUUID();
  const receipt = randomBytes(16).toString("base64url");
  const inserted = ctx.db.insert(latencySamples)
    .values({ id, path: "server-parent", provider, kind: cls, hour: hourOf(ctx.now()), receipt })
    .then(() => true, (err) => { quietly("push")(err); return false; });
  return {
    receipt,
    async settle(sent, origin) {
      if (!(await inserted)) return;
      const now = ctx.now();
      const done = sent
        ? ctx.db.update(latencySamples)
          .set({ ms: Math.max(0, now.getTime() - origin.getTime()), anchorAt: now })
          .where(eq(latencySamples.id, id))
        : ctx.db.delete(latencySamples).where(eq(latencySamples.id, id));
      await done.catch(quietly("push"));
    },
  };
}

/** The parent's device says the push arrived, or was opened. Unknown or repeated ids change nothing. */
export async function recordReceipt(ctx: Ctx, receipt: string, event: "delivered" | "opened") {
  if (!latencyOn(ctx)) return;
  const now = ctx.now();
  const key = eq(latencySamples.receipt, receipt);
  await (event === "delivered"
    ? ctx.db.update(latencySamples).set({ deliveredMs: sinceAnchor(now) }).where(and(key, isNull(latencySamples.deliveredMs)))
    : ctx.db.update(latencySamples).set({ openedMs: sinceAnchor(now) }).where(and(key, isNull(latencySamples.openedMs))));
}

/**
 * A wake-up was asked for: time it until the phone's next rules fetch. Only the first open wake-up
 * per phone counts, so a burst of changes measures from its first change, which is what the parent waits for.
 */
export function startWake(ctx: Ctx, phoneId: string, provider: "fcm" | "unifiedpush" | "poll", reason: WakeReason) {
  if (!latencyOn(ctx)) return;
  const now = ctx.now();
  void ctx.db.execute(sql`insert into ${latencySamples} (path, provider, kind, hour, anchor_at, phone_id)
    select 'server-child', ${provider}, ${reason}, ${hourOf(now).toISOString()}::timestamptz, ${now.toISOString()}::timestamptz, ${phoneId}
    where not exists (select 1 from ${latencySamples} where phone_id = ${phoneId} and ms is null)`)
    .catch(quietly("wake"));
}

/** The phone fetched its rules: close its open wake-up and forget which phone it was. */
export async function finishWake(ctx: Ctx, phoneId: string) {
  if (!latencyOn(ctx)) return;
  await ctx.db.update(latencySamples)
    .set({ ms: sinceAnchor(ctx.now()), phoneId: null, anchorAt: null })
    .where(and(eq(latencySamples.phoneId, phoneId), isNull(latencySamples.ms)))
    .catch(quietly("wake"));
}

export interface LatencyRow {
  path: "phone-server" | "server-parent" | "parent-device" | "server-child";
  provider: string | null;
  kind: string | null;
  samples: number;
  p50Ms: number;
  p95Ms: number;
}

/**
 * p50 and p95 per path for the last 7 days. `parent-device` is end to end: from the event reaching
 * the server to the parent's device confirming it, for the pushes that sent a receipt.
 */
export async function latencyStats(ctx: Ctx): Promise<LatencyRow[]> {
  if (!latencyOn(ctx)) return [];
  const since = new Date(ctx.now().getTime() - LATENCY_WINDOW_DAYS * DAY);
  const s = latencySamples;
  const percentiles = (value: ReturnType<typeof sql>) => ({
    samples: sql<number>`count(*)::int`,
    p50Ms: sql<number>`round(percentile_cont(0.5) within group (order by ${value}))::int`,
    p95Ms: sql<number>`round(percentile_cont(0.95) within group (order by ${value}))::int`,
  });
  const window = and(gte(s.hour, since), isNotNull(s.ms));
  const [legs, endToEnd] = await Promise.all([
    ctx.db.select({ path: s.path, provider: s.provider, kind: sql<string | null>`case when ${s.path} = 'phone-server' then ${s.kind} end`, ...percentiles(sql`${s.ms}`) })
      .from(s).where(window)
      .groupBy(s.path, s.provider, sql`case when ${s.path} = 'phone-server' then ${s.kind} end`),
    ctx.db.select({ provider: s.provider, ...percentiles(sql`${s.ms} + ${s.deliveredMs}`) })
      .from(s).where(and(window, eq(s.path, "server-parent"), isNotNull(s.deliveredMs)))
      .groupBy(s.provider),
  ]);
  const rows: LatencyRow[] = [
    ...legs.map((r) => ({ ...r, kind: r.kind ?? null })),
    ...endToEnd.map((r) => ({ path: "parent-device" as const, kind: null, ...r })),
  ];
  const order = ["phone-server", "server-parent", "parent-device", "server-child"];
  return rows.filter((r) => r.samples >= MIN_SAMPLES)
    .sort((a, b) => order.indexOf(a.path) - order.indexOf(b.path) || String(a.provider ?? a.kind).localeCompare(String(b.provider ?? b.kind)));
}

/** Old rows go; receipt ids and phone links go as soon as they are no longer needed. */
export async function sweepLatency(ctx: Ctx) {
  const now = ctx.now().getTime();
  await ctx.db.delete(latencySamples).where(lt(latencySamples.hour, new Date(now - KEEP_DAYS * DAY)));
  await ctx.db.update(latencySamples).set({ receipt: null, anchorAt: null })
    .where(and(eq(latencySamples.path, "server-parent"), isNotNull(latencySamples.receipt),
      lt(latencySamples.hour, new Date(now - RECEIPT_DAYS * DAY))));
  // A phone switched off for days says nothing about delivery, and the row should not keep its id.
  await ctx.db.delete(latencySamples).where(and(eq(latencySamples.path, "server-child"), isNull(latencySamples.ms),
    lt(latencySamples.anchorAt, new Date(now - RECEIPT_DAYS * DAY))));
}
