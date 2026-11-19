// SPDX-License-Identifier: Apache-2.0
//
// Requests from the phone (spec 4 and 5): the person with the phone asks for an app from its
// list or for a contact. A parent approves or declines. An approval is an ordinary rule
// change, so on a Self phone it waits for the key like any other loosening.

import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { contacts, pendingChanges, phoneApps, phoneRequests, phones } from "../db/schema.js";
import { type ChangeResult, type Op, submitChange } from "./changes.js";
import type { Ctx } from "./context.js";
import { notifyHousehold } from "./notifications.js";
import { wakePhone } from "./phones.js";

type Phone = typeof phones.$inferSelect;
type Request = typeof phoneRequests.$inferSelect;

/** At most this many open requests per phone, so a bored child cannot flood the parents. */
export const MAX_OPEN_REQUESTS = 10;
/** Decided requests are kept this long, so the phone can show the answer. */
export const REQUEST_HISTORY_DAYS = 30;

export type NewRequest = { kind: "app"; packageName: string } | { kind: "contact"; name: string; number: string };

/** What happened to a request that was already answered, in the vocabulary all screens share. */
export type RequestOutcome = "approvedByYou" | "approvedByOther" | "approvedOnPhone" | "declinedByYou" | "declinedByOther";

export class RequestError extends Error {
  constructor(
    readonly status: 404 | 409 | 429,
    message: string,
    readonly outcome?: RequestOutcome,
  ) {
    super(message);
  }
}

/** Who answered first, seen from [userId]. Undefined while the request is still open. */
export function outcomeOf(r: Pick<Request, "status" | "decidedBy" | "decidedVia">, userId: string | null): RequestOutcome | undefined {
  const mine = userId !== null && r.decidedBy === userId;
  if (r.status === "approved") return r.decidedVia === "phone" ? "approvedOnPhone" : mine ? "approvedByYou" : "approvedByOther";
  if (r.status === "rejected") return mine ? "declinedByYou" : "declinedByOther";
  return undefined;
}

async function alreadyAnswered(ctx: Ctx, phoneId: string, requestId: string, userId: string): Promise<RequestError> {
  const [row] = await ctx.db
    .select()
    .from(phoneRequests)
    .where(and(eq(phoneRequests.id, requestId), eq(phoneRequests.phoneId, phoneId)));
  return new RequestError(409, "this request is no longer open", row && outcomeOf(row, userId));
}

/** Creates a request from the phone, or returns the open one that asks for the same thing. */
export async function createRequest(ctx: Ctx, phone: Phone, input: NewRequest): Promise<{ request: Request; created: boolean }> {
  let label: string;
  if (input.kind === "app") {
    const [app] = await ctx.db
      .select()
      .from(phoneApps)
      .where(and(eq(phoneApps.phoneId, phone.id), eq(phoneApps.packageName, input.packageName), eq(phoneApps.installed, true)));
    if (!app) throw new RequestError(404, "this app is not on the phone's app list");
    if (app.allowed || app.core) throw new RequestError(409, "this app is already allowed");
    label = app.label;
  } else {
    const [known] = await ctx.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.phoneId, phone.id), eq(contacts.number, input.number)));
    if (known) throw new RequestError(409, "this number is already an approved contact");
    label = `${input.name} (${input.number})`;
  }

  const out = await ctx.db.transaction(async (tx) => {
    // One at a time per phone, so the limit and the duplicate check hold.
    await tx.execute(sql`select id from phones where id = ${phone.id} for update`);
    const open = await tx
      .select()
      .from(phoneRequests)
      .where(and(eq(phoneRequests.phoneId, phone.id), eq(phoneRequests.status, "pending")));
    const same = open.find((r) =>
      input.kind === "app"
        ? r.kind === "app" && r.packageName === input.packageName
        : r.kind === "contact" && r.contactNumber === input.number,
    );
    if (same) return { request: same, created: false };
    if (open.length >= MAX_OPEN_REQUESTS) throw new RequestError(429, "too many open requests; wait for an answer");
    const [row] = await tx
      .insert(phoneRequests)
      .values(
        input.kind === "app"
          ? { phoneId: phone.id, kind: "app", packageName: input.packageName }
          : { phoneId: phone.id, kind: "contact", contactName: input.name, contactNumber: input.number },
      )
      .returning();
    return { request: row!, created: true };
  });
  if (out.created) {
    await notifyHousehold(ctx, phone.id, {
      type: "request",
      phoneId: phone.id,
      phoneName: phone.name,
      kind: input.kind,
      what: label,
    });
  }
  return out;
}

/** The phone's own view: open requests and answers from the last 30 days. */
export async function phoneRequestList(ctx: Ctx, phoneId: string) {
  const since = new Date(ctx.now().getTime() - REQUEST_HISTORY_DAYS * 86_400_000);
  const rows = await ctx.db
    .select({ r: phoneRequests, changeStatus: pendingChanges.status, effectiveAt: pendingChanges.effectiveAt })
    .from(phoneRequests)
    .leftJoin(pendingChanges, eq(pendingChanges.id, phoneRequests.changeId))
    .where(
      and(
        eq(phoneRequests.phoneId, phoneId),
        or(eq(phoneRequests.status, "pending"), gte(phoneRequests.decidedAt, since)),
      ),
    )
    .orderBy(desc(phoneRequests.createdAt));
  return rows.map(({ r, changeStatus, effectiveAt }) => ({
    ...requestJson(r),
    // An approval that the key then turned down (or that failed) never took effect.
    status:
      r.status === "approved" && (changeStatus === "rejected" || changeStatus === "cancelled" || changeStatus === "failed")
        ? ("rejected" as const)
        : r.status,
    // On a Self phone an approval can still wait for the key.
    waitingForKey: r.status === "approved" && changeStatus === "pending",
    effectiveAt: changeStatus === "pending" ? (effectiveAt?.toISOString() ?? null) : null,
  }));
}

export function requestJson(r: Request) {
  return {
    id: r.id,
    kind: r.kind,
    packageName: r.packageName,
    name: r.contactName,
    number: r.contactNumber,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    /** "phone" when a parent answered on the phone itself with the parent PIN, else "parent" (or null while open). */
    decidedVia: r.decidedAt ? (r.decidedVia ?? "parent") : null,
  };
}

/** Open requests for the parent app, with the app's name. */
export async function openRequests(ctx: Ctx, phoneIds: string[]) {
  if (phoneIds.length === 0) return [];
  const rows = await ctx.db
    .select({ r: phoneRequests, appLabel: phoneApps.label })
    .from(phoneRequests)
    .leftJoin(
      phoneApps,
      and(eq(phoneApps.phoneId, phoneRequests.phoneId), eq(phoneApps.packageName, phoneRequests.packageName)),
    )
    .where(and(inArray(phoneRequests.phoneId, phoneIds), eq(phoneRequests.status, "pending")))
    .orderBy(phoneRequests.createdAt);
  return rows.map(({ r, appLabel }) => ({ ...requestJson(r), phoneId: r.phoneId, appLabel }));
}

/** Requests answered in the last [RECENT_ANSWER_DAYS] days, newest first, so a parent sees what happened while away. */
export const RECENT_ANSWER_DAYS = 3;

export async function recentAnswers(ctx: Ctx, phoneId: string) {
  const since = new Date(ctx.now().getTime() - RECENT_ANSWER_DAYS * 86_400_000);
  const rows = await ctx.db
    .select({ r: phoneRequests, appLabel: phoneApps.label })
    .from(phoneRequests)
    .leftJoin(
      phoneApps,
      and(eq(phoneApps.phoneId, phoneRequests.phoneId), eq(phoneApps.packageName, phoneRequests.packageName)),
    )
    .where(and(eq(phoneRequests.phoneId, phoneId), inArray(phoneRequests.status, ["approved", "rejected"]), gte(phoneRequests.decidedAt, since)))
    .orderBy(desc(phoneRequests.decidedAt))
    .limit(5);
  return rows.map(({ r, appLabel }) => ({ ...requestJson(r), phoneId: r.phoneId, appLabel }));
}

/**
 * Approves a request: applies it as a rule change (through the key on a Self phone).
 * The parent may correct a contact's name. A failed change leaves the request open.
 */
export async function approveRequest(
  ctx: Ctx,
  phone: Phone,
  requestId: string,
  userId: string,
  opts: { name?: string } = {},
): Promise<ChangeResult> {
  const [claimed] = await ctx.db
    .update(phoneRequests)
    .set({ status: "approved", decidedBy: userId, decidedVia: "parent", decidedAt: ctx.now() })
    .where(and(eq(phoneRequests.id, requestId), eq(phoneRequests.phoneId, phone.id), eq(phoneRequests.status, "pending")))
    .returning();
  if (!claimed) throw await alreadyAnswered(ctx, phone.id, requestId, userId);
  const op: Op =
    claimed.kind === "app"
      ? { type: "app.set", packageName: claimed.packageName!, allowed: true }
      : { type: "contact.add", name: opts.name ?? claimed.contactName!, number: claimed.contactNumber! };
  try {
    const result = await submitChange(ctx, phone, userId, op);
    if (result.status === "pending") {
      await ctx.db.update(phoneRequests).set({ changeId: result.change.id }).where(eq(phoneRequests.id, claimed.id));
    }
    return result;
  } catch (err) {
    await ctx.db
      .update(phoneRequests)
      .set({ status: "pending", decidedBy: null, decidedVia: null, decidedAt: null })
      .where(eq(phoneRequests.id, claimed.id));
    throw err;
  }
}

/**
 * A parent next to the child approved the request on the phone with the parent PIN. The phone
 * checked the PIN and is the authority for what it did, so this is a report, not a question:
 * it never fails because someone answered first. The first answer wins and a repeat changes
 * nothing, so the phone can retry safely. Only child phones have a parent PIN.
 */
export async function approveRequestOnPhone(
  ctx: Ctx,
  phone: Phone,
  requestId: string,
): Promise<{ request: Request; won: boolean }> {
  if (phone.profile !== "child") throw new RequestError(409, "approval on the phone is only for child phones");
  const [claimed] = await ctx.db
    .update(phoneRequests)
    .set({ status: "approved", decidedBy: null, decidedVia: "phone", decidedAt: ctx.now() })
    .where(and(eq(phoneRequests.id, requestId), eq(phoneRequests.phoneId, phone.id), eq(phoneRequests.status, "pending")))
    .returning();
  if (!claimed) {
    const [row] = await ctx.db
      .select()
      .from(phoneRequests)
      .where(and(eq(phoneRequests.id, requestId), eq(phoneRequests.phoneId, phone.id)));
    if (!row) throw new RequestError(404, "request not found");
    return { request: row, won: false };
  }
  const op: Op =
    claimed.kind === "app"
      ? { type: "app.set", packageName: claimed.packageName!, allowed: true }
      : { type: "contact.add", name: claimed.contactName!, number: claimed.contactNumber! };
  try {
    const result = await submitChange(ctx, phone, null, op);
    if (result.status === "pending") {
      await ctx.db.update(phoneRequests).set({ changeId: result.change.id }).where(eq(phoneRequests.id, claimed.id));
    }
  } catch (err) {
    await ctx.db
      .update(phoneRequests)
      .set({ status: "pending", decidedBy: null, decidedVia: null, decidedAt: null })
      .where(eq(phoneRequests.id, claimed.id));
    throw err;
  }
  let what = claimed.contactName ? `${claimed.contactName} (${claimed.contactNumber})` : (claimed.packageName ?? "");
  if (claimed.kind === "app") {
    const [app] = await ctx.db
      .select({ label: phoneApps.label })
      .from(phoneApps)
      .where(and(eq(phoneApps.phoneId, phone.id), eq(phoneApps.packageName, claimed.packageName!)));
    what = app?.label ?? what;
  }
  await notifyHousehold(ctx, phone.id, { type: "request-on-phone", phoneId: phone.id, phoneName: phone.name, kind: claimed.kind, what });
  return { request: claimed, won: true };
}

export async function rejectRequest(ctx: Ctx, phone: Phone, requestId: string, userId: string) {
  const [row] = await ctx.db
    .update(phoneRequests)
    .set({ status: "rejected", decidedBy: userId, decidedVia: "parent", decidedAt: ctx.now() })
    .where(and(eq(phoneRequests.id, requestId), eq(phoneRequests.phoneId, phone.id), eq(phoneRequests.status, "pending")))
    .returning();
  if (!row) throw await alreadyAnswered(ctx, phone.id, requestId, userId);
  // The phone shows the answer; let it know now.
  await wakePhone(ctx, phone.id, "rules");
}
