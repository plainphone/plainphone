// SPDX-License-Identifier: Apache-2.0
//
// An overall cap on the mail the server sends (MAIL_HOURLY_CAP, MAIL_DAILY_CAP; docs/operations.md,
// "Mail caps"). Sign-in is by mail only, so a mail server that hits its own send limit would lock
// everyone out with an error. With a cap set a little under that limit, the server stops first and
// says so: a sign-in gets "try again in a little while", other mail is skipped like any failed mail.
//
// Every kind of mail counts: sign-in links, invitations, alerts, summaries, receipts and SOS. An SOS
// is still sent at the cap (parents must hear about it) and still counted. The count is kept in
// rate_limit_hits, one row per UTC hour and per UTC day for the whole server (no address, no
// household), so it survives restarts and holds across processes. The sweeper deletes old rows.
//
// The wrapper also turns a temporary refusal by the mail server (SMTP 4xx) into the same answer,
// logged with the code only (providers/mail.ts).

import { and, eq, inArray, sql } from "drizzle-orm";
import { rateLimitHits } from "../db/schema.js";
import { MailUnavailableError, type Mail, type MailProvider, type SendOptions } from "../providers/mail.js";
import type { Ctx } from "./context.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** The subject of the counting rows: the whole server. */
const SUBJECT = "all";

interface CapWindow {
  window: "hour" | "day";
  bucket: string;
  ms: number;
  cap: number;
  setting: string;
}

function capWindows(ctx: Ctx): CapWindow[] {
  return [
    { window: "hour", bucket: "mail-hour", ms: HOUR, cap: ctx.cfg.MAIL_HOURLY_CAP, setting: "MAIL_HOURLY_CAP" },
    { window: "day", bucket: "mail-day", ms: DAY, cap: ctx.cfg.MAIL_DAILY_CAP, setting: "MAIL_DAILY_CAP" },
  ];
}

const windowStart = (now: Date, ms: number) => new Date(Math.floor(now.getTime() / ms) * ms);

/** Either cap is set. Off (the default), nothing is counted or locked. */
export function mailCapOn(ctx: Ctx): boolean {
  return ctx.cfg.MAIL_HOURLY_CAP > 0 || ctx.cfg.MAIL_DAILY_CAP > 0;
}

/** Mails counted in the current UTC hour and day. */
export async function mailsCounted(ctx: Ctx, now = ctx.now()): Promise<{ hour: number; day: number }> {
  const windows = capWindows(ctx);
  const rows = await ctx.db
    .select({ bucket: rateLimitHits.bucket, windowStart: rateLimitHits.windowStart, hits: rateLimitHits.hits })
    .from(rateLimitHits)
    .where(and(eq(rateLimitHits.subject, SUBJECT), inArray(rateLimitHits.bucket, windows.map((w) => w.bucket))));
  const hits = (w: CapWindow) =>
    rows.find((r) => r.bucket === w.bucket && r.windowStart.getTime() === windowStart(now, w.ms).getTime())?.hits ?? 0;
  return { hour: hits(windows[0]!), day: hits(windows[1]!) };
}

/** Per process: the hour the "cap reached" warning was last logged, and counters for /api/metrics. */
const warnedHour = new WeakMap<Ctx, number>();
const counters = new WeakMap<Ctx, { sent: number; cap: number; provider: number }>();

function counter(ctx: Ctx) {
  let c = counters.get(ctx);
  if (!c) counters.set(ctx, (c = { sent: 0, cap: 0, provider: 0 }));
  return c;
}

/**
 * Takes one mail from this hour's and today's allowance. At a cap, throws MailUnavailableError and
 * counts nothing, unless the mail is urgent (an SOS): that one is always counted and sent.
 */
export async function takeMailSlot(ctx: Ctx, urgent = false): Promise<void> {
  if (!mailCapOn(ctx)) return;
  const full = await ctx.db.transaction(async (tx) => {
    // Two processes must not both take the last mail.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('plainphone.mail_cap'))`);
    const now = ctx.now();
    const windows = capWindows(ctx).map((w) => ({ ...w, start: windowStart(now, w.ms) }));
    const rows = await tx
      .select({ bucket: rateLimitHits.bucket, windowStart: rateLimitHits.windowStart, hits: rateLimitHits.hits })
      .from(rateLimitHits)
      .where(and(eq(rateLimitHits.subject, SUBJECT), inArray(rateLimitHits.bucket, windows.map((w) => w.bucket))));
    const hits = (w: (typeof windows)[number]) =>
      rows.find((r) => r.bucket === w.bucket && r.windowStart.getTime() === w.start.getTime())?.hits ?? 0;
    const over = windows.filter((w) => w.cap > 0 && hits(w) >= w.cap);
    if (over.length && !urgent) return over;
    for (const w of windows) {
      await tx
        .insert(rateLimitHits)
        .values({ bucket: w.bucket, subject: SUBJECT, windowStart: w.start, hits: 1, expiresAt: new Date(w.start.getTime() + w.ms) })
        .onConflictDoUpdate({
          target: [rateLimitHits.bucket, rateLimitHits.subject, rateLimitHits.windowStart],
          set: { hits: sql`${rateLimitHits.hits} + 1` },
        });
    }
    return null;
  });
  if (!full) return;
  // Both caps full: the later window decides when mail goes out again.
  const retryAt = new Date(Math.max(...full.map((w) => w.start.getTime() + w.ms)));
  counter(ctx).cap++;
  const hour = windowStart(ctx.now(), HOUR).getTime();
  if (warnedHour.get(ctx) !== hour) {
    warnedHour.set(ctx, hour);
    const which = full.map((w) => `${w.setting}=${w.cap}`).join(", ");
    console.warn(`mail cap reached (${which}): mail is refused until ${retryAt.toISOString()}; SOS mail still goes out`);
  }
  throw new MailUnavailableError("cap", retryAt);
}

/**
 * Wraps the configured provider: every mail passes the cap first, and a temporary refusal by the
 * mail server is logged with its code only. createApp installs it, so every sender goes through it.
 */
export class CappedMailProvider implements MailProvider {
  constructor(
    private readonly ctx: Ctx,
    readonly inner: MailProvider,
  ) {}

  get name() {
    return this.inner.name;
  }

  get canSend() {
    return this.inner.canSend;
  }

  send(mail: Mail, opts: SendOptions = {}): Promise<void> {
    // With the caps off the caller gets the provider's own promise: no extra wait, not even a tick.
    if (!mailCapOn(this.ctx)) return this.watch(this.inner.send(mail, opts));
    return takeMailSlot(this.ctx, opts.urgent ?? false).then(() => this.watch(this.inner.send(mail, opts)));
  }

  /** Counts and logs the outcome on the side; the caller still gets the result as it is. */
  private watch(sending: Promise<void>): Promise<void> {
    Promise.resolve(sending).then(
      () => {
        counter(this.ctx).sent++;
      },
      (err: unknown) => {
        if (err instanceof MailUnavailableError && err.reason === "provider") {
          counter(this.ctx).provider++;
          console.warn(`mail server refused for now (SMTP ${err.smtpCode})`);
        }
      },
    );
    return sending;
  }
}

/** Puts the cap in front of ctx.mail, once. */
export function installMailCap(ctx: Ctx): void {
  if (!(ctx.mail instanceof CappedMailProvider)) ctx.mail = new CappedMailProvider(ctx, ctx.mail);
}

/** The callers' catch blocks log nothing for these: the cap logs once an hour, a 4xx once per mail. */
export function isMailUnavailable(err: unknown): err is MailUnavailableError {
  return err instanceof MailUnavailableError;
}

/** Prometheus lines for /api/metrics; every line always shows. */
export async function mailMetricsText(ctx: Ctx): Promise<string> {
  const c = counter(ctx);
  const now = mailCapOn(ctx) ? await mailsCounted(ctx) : { hour: 0, day: 0 };
  return [
    "# HELP plainphone_mail_total Mails since start-up: sent, refused at the server's own cap, or refused for now (4xx) by the mail server.",
    "# TYPE plainphone_mail_total counter",
    `plainphone_mail_total{outcome="sent"} ${c.sent}`,
    `plainphone_mail_total{outcome="cap"} ${c.cap}`,
    `plainphone_mail_total{outcome="provider"} ${c.provider}`,
    "# HELP plainphone_mail_counted Mails counted towards the cap in the current UTC hour and day (0 while no cap is set).",
    "# TYPE plainphone_mail_counted gauge",
    `plainphone_mail_counted{window="hour"} ${now.hour}`,
    `plainphone_mail_counted{window="day"} ${now.day}`,
    "# HELP plainphone_mail_cap MAIL_HOURLY_CAP and MAIL_DAILY_CAP (0: no cap).",
    "# TYPE plainphone_mail_cap gauge",
    `plainphone_mail_cap{window="hour"} ${ctx.cfg.MAIL_HOURLY_CAP}`,
    `plainphone_mail_cap{window="day"} ${ctx.cfg.MAIL_DAILY_CAP}`,
    "",
  ].join("\n");
}
