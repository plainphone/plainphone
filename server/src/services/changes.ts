// SPDX-License-Identifier: Apache-2.0
//
// Every rule change goes through submitChange(). On a Child phone, and for any
// change that tightens the rules, it applies at once. On a Self phone a change
// that loosens the rules waits for the key: a delay, or a trusted person (D12).

import { and, eq, inArray, lte, sql } from "drizzle-orm";
import {
  contacts,
  dnsSettings,
  type DnsCategory,
  pendingChanges,
  phoneApps,
  phones,
  schedules,
  selfKeys,
  users,
} from "../db/schema.js";
import { approvalRequestMail, inviteMail, toLocale } from "../lib/mail-templates.js";
import type { KeyInput, ScheduleInput } from "../lib/validation.js";
import type { Ctx } from "./context.js";
import { syncDns } from "./dns.js";
import { wakePhone } from "./phones.js";

export type Op =
  | { type: "app.set"; packageName: string; allowed: boolean }
  | { type: "contact.add"; name: string; number: string }
  | { type: "contact.remove"; contactId: string }
  | { type: "dns.category"; category: DnsCategory; blocked: boolean }
  | { type: "dns.allowDomain"; domain: string; present: boolean }
  | { type: "dns.blockDomain"; domain: string; present: boolean }
  | { type: "schedule.create"; schedule: ScheduleInput }
  | { type: "schedule.update"; scheduleId: string; schedule: ScheduleInput }
  | { type: "schedule.delete"; scheduleId: string }
  | { type: "key.set"; key: KeyInput }
  | { type: "phone.remove"; dnsClientId: string };

export class ChangeError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

type Phone = typeof phones.$inferSelect;
type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];
type DbLike = Ctx["db"] | Tx;

export type ChangeResult =
  | { status: "applied"; op: Op }
  | { status: "pending"; op: Op; change: typeof pendingChanges.$inferSelect };

const WEEK = 7 * 1440;

/** Minutes of the week a schedule covers, as a bitmap. Windows may cross midnight. */
export function coverage(s: Pick<ScheduleInput, "days" | "startMinute" | "endMinute">): Uint8Array {
  const out = new Uint8Array(WEEK);
  for (const day of s.days) {
    const base = (day - 1) * 1440;
    const len = s.endMinute > s.startMinute ? s.endMinute - s.startMinute : 1440 - s.startMinute + s.endMinute;
    for (let m = 0; m < len; m++) out[(base + s.startMinute + m) % WEEK] = 1;
  }
  return out;
}

/** A new window loosens if it frees any minute the old one locked, or allows more apps. */
export function scheduleLoosens(before: ScheduleInput, after: ScheduleInput): boolean {
  const a = coverage(before);
  const b = coverage(after);
  for (let i = 0; i < WEEK; i++) if (a[i] && !b[i]) return true;
  const allowedBefore = new Set(before.allowedPackages);
  return after.allowedPackages.some((p) => !allowedBefore.has(p));
}

async function loadSchedule(db: DbLike, phoneId: string, scheduleId: string) {
  const [row] = await db
    .select()
    .from(schedules)
    .where(and(eq(schedules.id, scheduleId), eq(schedules.phoneId, phoneId)));
  return row;
}

/** A window that lists a hidden app would show it during the window. */
async function showsHiddenApp(db: DbLike, phoneId: string, packages: string[]): Promise<boolean> {
  if (packages.length === 0) return false;
  const visible = await db
    .select({ p: phoneApps.packageName })
    .from(phoneApps)
    .where(and(eq(phoneApps.phoneId, phoneId), inArray(phoneApps.packageName, packages), eq(phoneApps.allowed, true)));
  return visible.length < new Set(packages).size;
}

/** Whether an op makes the rules less strict, judged against the current state. */
export async function isLoosening(db: DbLike, phone: Phone, op: Op): Promise<boolean> {
  switch (op.type) {
    case "app.set":
      return op.allowed;
    case "contact.add":
      return true;
    case "contact.remove":
      return false;
    case "dns.category":
      return !op.blocked;
    case "dns.allowDomain":
      return op.present;
    case "dns.blockDomain":
      return !op.present;
    case "schedule.create":
      return showsHiddenApp(db, phone.id, op.schedule.allowedPackages);
    case "phone.remove":
      // Removing a Self phone and pairing it again as a Child would drop the key.
      return true;
    case "schedule.delete":
      return true;
    case "schedule.update": {
      const current = await loadSchedule(db, phone.id, op.scheduleId);
      if (!current) throw new ChangeError(404, "schedule not found");
      // scheduleLoosens already counts every newly listed app as loosening.
      return scheduleLoosens(current, op.schedule);
    }
    case "key.set": {
      const [current] = await db.select().from(selfKeys).where(eq(selfKeys.phoneId, phone.id));
      if (!current) return false;
      // Only a longer delay with nothing else changed is a tightening. Any change to
      // the key type, trusted person or pay-to-unlock settings goes through the key.
      const sameOtherwise =
        current.keyType === op.key.keyType &&
        (current.trustedEmail ?? null) === (op.key.trustedEmail ?? null) &&
        current.payUnlockEnabled === op.key.payUnlockEnabled &&
        current.payUnlockAmount === op.key.payUnlockAmount &&
        current.payUnlockRecipient === op.key.payUnlockRecipient;
      return !(sameOtherwise && op.key.delayHours >= current.delayHours);
    }
  }
}

/** Checks that an op refers to things that exist, before it is queued or applied. */
async function validateOp(db: DbLike, phone: Phone, op: Op) {
  switch (op.type) {
    case "app.set": {
      const [app] = await db
        .select()
        .from(phoneApps)
        .where(and(eq(phoneApps.phoneId, phone.id), eq(phoneApps.packageName, op.packageName)));
      if (!app) throw new ChangeError(404, "app not reported by this phone");
      if (app.core && !op.allowed) throw new ChangeError(400, "core apps such as the dialer cannot be hidden");
      return;
    }
    case "contact.remove": {
      const [c] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.id, op.contactId), eq(contacts.phoneId, phone.id)));
      if (!c) throw new ChangeError(404, "contact not found");
      return;
    }
    case "schedule.update":
    case "schedule.delete": {
      if (!(await loadSchedule(db, phone.id, op.scheduleId))) throw new ChangeError(404, "schedule not found");
      return;
    }
    case "key.set":
      if (phone.profile !== "self") throw new ChangeError(400, "only Self phones have a key");
      return;
    default:
      return;
  }
}

/** Applies an op. Idempotent where it can be, since a delayed op may meet a changed state. */
export async function applyOp(ctx: Ctx, db: DbLike, phone: Phone, op: Op): Promise<{ dns: boolean }> {
  switch (op.type) {
    case "app.set":
      await db
        .update(phoneApps)
        .set({ allowed: op.allowed })
        .where(and(eq(phoneApps.phoneId, phone.id), eq(phoneApps.packageName, op.packageName)));
      return { dns: false };
    case "contact.add":
      await db
        .insert(contacts)
        .values({ phoneId: phone.id, name: op.name, number: op.number })
        .onConflictDoUpdate({ target: [contacts.phoneId, contacts.number], set: { name: op.name } });
      return { dns: false };
    case "contact.remove":
      await db.delete(contacts).where(and(eq(contacts.id, op.contactId), eq(contacts.phoneId, phone.id)));
      return { dns: false };
    case "dns.category": {
      const col = dnsSettings.blockedCategories;
      await db
        .update(dnsSettings)
        .set({
          blockedCategories: op.blocked
            ? sql`array_append(array_remove(${col}, ${op.category}::text), ${op.category}::text)`
            : sql`array_remove(${col}, ${op.category}::text)`,
        })
        .where(eq(dnsSettings.phoneId, phone.id));
      return { dns: true };
    }
    case "dns.allowDomain":
    case "dns.blockDomain": {
      const col = op.type === "dns.allowDomain" ? dnsSettings.allowDomains : dnsSettings.blockDomains;
      const other = op.type === "dns.allowDomain" ? dnsSettings.blockDomains : dnsSettings.allowDomains;
      const key = op.type === "dns.allowDomain" ? "allowDomains" : "blockDomains";
      const otherKey = op.type === "dns.allowDomain" ? "blockDomains" : "allowDomains";
      await db
        .update(dnsSettings)
        .set(
          op.present
            ? {
                [key]: sql`array_append(array_remove(${col}, ${op.domain}::text), ${op.domain}::text)`,
                // A domain is never on both lists.
                [otherKey]: sql`array_remove(${other}, ${op.domain}::text)`,
              }
            : { [key]: sql`array_remove(${col}, ${op.domain}::text)` },
        )
        .where(eq(dnsSettings.phoneId, phone.id));
      return { dns: true };
    }
    case "schedule.create":
      await db.insert(schedules).values({ phoneId: phone.id, ...op.schedule });
      return { dns: false };
    case "schedule.update":
      await db
        .update(schedules)
        .set(op.schedule)
        .where(and(eq(schedules.id, op.scheduleId), eq(schedules.phoneId, phone.id)));
      return { dns: false };
    case "schedule.delete":
      await db.delete(schedules).where(and(eq(schedules.id, op.scheduleId), eq(schedules.phoneId, phone.id)));
      return { dns: false };
    case "key.set": {
      const k = op.key;
      let trustedUserId: string | null = null;
      if (k.keyType === "trusted" && k.trustedEmail) {
        const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, k.trustedEmail));
        trustedUserId = u?.id ?? null;
      }
      const values = {
        keyType: k.keyType,
        delayHours: k.delayHours,
        trustedEmail: k.keyType === "trusted" ? k.trustedEmail : null,
        trustedUserId: k.keyType === "trusted" ? trustedUserId : null,
        payUnlockEnabled: k.payUnlockEnabled,
        payUnlockAmount: k.payUnlockAmount,
        payUnlockRecipient: k.payUnlockRecipient,
      };
      await db
        .insert(selfKeys)
        .values({ phoneId: phone.id, ...values })
        .onConflictDoUpdate({ target: selfKeys.phoneId, set: values });
      return { dns: false };
    }
    case "phone.remove":
      await db.delete(phones).where(eq(phones.id, phone.id));
      return { dns: false };
  }
}

/** Side effects outside the database, after an op has been applied. */
async function afterApply(ctx: Ctx, op: Op, requestedBy: string | null) {
  if (op.type === "phone.remove") {
    try {
      await ctx.dns.deleteClient(op.dnsClientId);
    } catch (err) {
      console.error(`DNS delete failed for ${op.dnsClientId}: ${(err as Error).message}`);
    }
    return;
  }
  if (op.type !== "key.set" || op.key.keyType !== "trusted" || !op.key.trustedEmail || !ctx.mail.canSend) return;
  const [requester] = requestedBy
    ? await ctx.db.select({ locale: users.locale }).from(users).where(eq(users.id, requestedBy))
    : [];
  try {
    await ctx.mail.send(
      inviteMail(
        op.key.trustedEmail,
        toLocale(requester?.locale),
        ctx.cfg.PUBLIC_URL,
        `${ctx.cfg.PUBLIC_URL}/login`,
        "trusted",
        30,
      ),
    );
  } catch (err) {
    console.error(`could not mail the trusted person: ${(err as Error).message}`);
  }
}

/** Applies or queues one change. */
export async function submitChange(ctx: Ctx, phone: Phone, userId: string, op: Op): Promise<ChangeResult> {
  const result = await ctx.db.transaction(async (tx) => {
    // Serialise changes per phone, so loosening checks see a stable state.
    await tx.execute(sql`select id from phones where id = ${phone.id} for update`);
    await validateOp(tx, phone, op);
    if (phone.profile === "self" && (await isLoosening(tx, phone, op))) {
      const [key] = await tx.select().from(selfKeys).where(eq(selfKeys.phoneId, phone.id));
      // A trusted person who has never signed in cannot approve anything. Fall back to
      // the delay, so a mistyped address never locks the owner in for good.
      const keyType = key?.keyType === "trusted" && key.trustedUserId ? "trusted" : "delay";
      const delayHours = key?.delayHours ?? 24;
      const [change] = await tx
        .insert(pendingChanges)
        .values({
          phoneId: phone.id,
          requestedBy: userId,
          op,
          keyType,
          effectiveAt: keyType === "delay" ? new Date(ctx.now().getTime() + delayHours * 3_600_000) : null,
        })
        .returning();
      const notify = keyType === "trusted" ? key!.trustedUserId : null;
      return { status: "pending" as const, op, change: change!, notify };
    }
    const applied = await applyOp(ctx, tx, phone, op);
    return { status: "applied" as const, op, dns: applied.dns };
  });
  if (result.status === "applied") {
    if (result.dns) await syncDns(ctx, phone.id);
    await afterApply(ctx, op, userId);
    await wakePhone(ctx, phone.id, "rules");
    return { status: "applied", op };
  }
  // The phone shows pending changes with a countdown, so it should know at once.
  await wakePhone(ctx, phone.id, "rules");
  const { notify, ...pending } = result;
  if (notify) await mailTrustedPerson(ctx, notify, phone.name);
  return pending;
}

/** Tells the trusted person that a request waits for them. A failed mail never fails the change. */
async function mailTrustedPerson(ctx: Ctx, trustedUserId: string, phoneName: string) {
  if (!ctx.mail.canSend) return;
  const [person] = await ctx.db
    .select({ email: users.email, locale: users.locale })
    .from(users)
    .where(eq(users.id, trustedUserId));
  if (!person) return;
  try {
    await ctx.mail.send(approvalRequestMail(person.email, toLocale(person.locale), ctx.cfg.PUBLIC_URL, phoneName));
  } catch (err) {
    console.error(`could not mail the trusted person about a request: ${(err as Error).message}`);
  }
}

/** Applies a pending change now (delay passed, trusted person approved, or paid). */
export async function applyPending(
  ctx: Ctx,
  changeId: string,
  decidedBy: string | null,
): Promise<"applied" | "gone"> {
  const out = await ctx.db.transaction(async (tx) => {
    const [change] = await tx
      .select()
      .from(pendingChanges)
      .where(and(eq(pendingChanges.id, changeId), eq(pendingChanges.status, "pending")))
      .for("update");
    if (!change) return null;
    const [phone] = await tx.select().from(phones).where(eq(phones.id, change.phoneId));
    if (!phone) return null;
    let dns = false;
    let status: "applied" | "failed" = "applied";
    try {
      // A savepoint, so a failed op (e.g. its target was deleted meanwhile) does not
      // abort the outer transaction that marks the change as handled.
      dns = (await tx.transaction((sp) => applyOp(ctx, sp, phone, change.op as Op))).dns;
    } catch (err) {
      console.error(`pending change ${change.id} could not be applied`, err);
      status = "failed";
    }
    await tx
      .update(pendingChanges)
      .set({ status, decidedBy, decidedAt: ctx.now() })
      .where(eq(pendingChanges.id, change.id));
    return { phoneId: phone.id, dns, op: change.op as Op, requestedBy: change.requestedBy };
  });
  if (!out) return "gone";
  if (out.dns) await syncDns(ctx, out.phoneId);
  await afterApply(ctx, out.op, out.requestedBy);
  await wakePhone(ctx, out.phoneId, "rules");
  return "applied";
}

/** Applies delay-key changes whose time has come. Called by the sweeper and before serving rules. */
export async function applyDueChanges(ctx: Ctx, phoneId?: string): Promise<number> {
  const due = await ctx.db
    .select({ id: pendingChanges.id })
    .from(pendingChanges)
    .where(
      and(
        eq(pendingChanges.status, "pending"),
        eq(pendingChanges.keyType, "delay"),
        lte(pendingChanges.effectiveAt, ctx.now()),
        phoneId ? eq(pendingChanges.phoneId, phoneId) : undefined,
      ),
    );
  let n = 0;
  for (const c of due) if ((await applyPending(ctx, c.id, null)) === "applied") n++;
  return n;
}

export async function listPending(ctx: Ctx, phoneIds: string[]) {
  if (phoneIds.length === 0) return [];
  return ctx.db
    .select()
    .from(pendingChanges)
    .where(and(inArray(pendingChanges.phoneId, phoneIds), eq(pendingChanges.status, "pending")))
    .orderBy(pendingChanges.createdAt);
}
