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
  householdInvites,
  householdMembers,
  pendingChanges,
  phoneApps,
  phoneSettings,
  phoneMoves,
  phones,
  schedules,
  selfKeys,
  timeBonuses,
  timeLimits,
  users,
} from "../db/schema.js";
import { matchesApprovalChallenge } from "../lib/approval-challenge.js";
import { approvalRequestMail, inviteMail, toLocale } from "../lib/mail-templates.js";
import {
  checkSetting,
  type HomeUpdate,
  homeUpdateInput,
  isSettingKey,
  type SettingKey,
  type SettingState,
  settingLoosens,
} from "../lib/phone-settings.js";
import type { KeyInput, ScheduleInput } from "../lib/validation.js";
import { approvalBonusDate, approvalRevision, loadApprovalSummaries } from "./approval-summary.js";
import type { Ctx } from "./context.js";
import { getCatalog, phoneCountry } from "./catalog.js";
import { queueDnsDeletions, retryDnsDeletions, syncDns } from "./dns.js";
import { notifyUsers } from "./notifications.js";
import { type Limit, limitLoosens, localDate, TOTAL } from "./limits.js";
import { activateMove, MoveError } from "./server-move.js";
import { wakePhone } from "./phones.js";

export type Op =
  | { type: "app.set"; packageName: string; allowed: boolean }
  | { type: "contact.add"; name: string; number: string }
  | { type: "contact.remove"; contactId: string }
  | { type: "contact.schedule"; restricted: boolean }
  | { type: "dns.method"; method: Phone["filterMethod"] }
  | { type: "dns.category"; category: DnsCategory; blocked: boolean }
  | { type: "dns.allowDomain"; domain: string; present: boolean }
  | { type: "dns.blockDomain"; domain: string; present: boolean }
  | { type: "schedule.create"; schedule: ScheduleInput }
  | { type: "schedule.update"; scheduleId: string; schedule: ScheduleInput }
  | { type: "schedule.delete"; scheduleId: string }
  | { type: "setting.set"; key: SettingKey; setting: SettingState }
  | { type: "home.set"; home: HomeUpdate }
  | { type: "key.set"; key: KeyInput }
  | { type: "phone.remove"; dnsClientId: string }
  | { type: "phone.release" }
  | { type: "move.allow"; allowed: boolean }
  | { type: "move.start"; exportId: string; serverUrl: string }
  | { type: "timeLimit.set"; packageName: string; limit: Limit | null }
  | { type: "timeLimit.bonus"; packageName: string; date: string; minutes: number }
  | { type: "catalog.add"; packageName: string; label: string }
  | { type: "catalog.remove"; packageName: string };

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
    case "move.allow": return op.allowed;
    case "move.start": return true;
    case "app.set":
      return op.allowed;
    case "contact.add":
      return true;
    case "contact.remove":
      return false;
    case "contact.schedule":
      return phone.selfScheduleContacts === null || !op.restricted;
    case "dns.method":
      return phone.filterMethod !== op.method;
    case "dns.category":
      return !op.blocked;
    case "dns.allowDomain":
      return op.present;
    case "dns.blockDomain":
      return !op.present;
    case "schedule.create":
      return showsHiddenApp(db, phone.id, op.schedule.allowedPackages);
    case "phone.remove":
    case "phone.release":
      // Removing a Self phone and pairing it again as a Child would drop the key. Releasing
      // it frees the phone altogether. A phone that never paired (a setup QR nobody
      // scanned) has nothing to escape from.
      return phone.pairedAt !== null;
    case "setting.set": {
      const [row] = await db
        .select({ settings: phoneSettings.settings })
        .from(phoneSettings)
        .where(eq(phoneSettings.phoneId, phone.id));
      return settingLoosens(op.key, row?.settings?.[op.key], op.setting);
    }
    case "home.set":
      // The home screen only arranges apps the rules already allow.
      return false;
    case "schedule.delete":
      return true;
    case "schedule.update": {
      const current = await loadSchedule(db, phone.id, op.scheduleId);
      if (!current) throw new ChangeError(404, "schedule not found");
      // scheduleLoosens already counts every newly listed app as loosening.
      return scheduleLoosens(current, op.schedule);
    }
    case "timeLimit.set": {
      const [current] = await db
        .select()
        .from(timeLimits)
        .where(and(eq(timeLimits.phoneId, phone.id), eq(timeLimits.packageName, op.packageName)));
      return limitLoosens(current ?? null, op.limit);
    }
    case "timeLimit.bonus":
      return true;
    case "catalog.add":
      return true;
    case "catalog.remove":
      return false;
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
    case "contact.schedule":
      if (phone.profile !== "self") throw new ChangeError(400, "only Self phones can change scheduled contacts");
      return;
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
      if (op.key.trustedEmail) {
        const [member] = await db.select({ id: users.id }).from(users)
          .innerJoin(householdMembers, and(eq(householdMembers.userId, users.id), eq(householdMembers.householdId, phone.householdId)))
          .where(eq(users.email, op.key.trustedEmail));
        if (member) throw new ChangeError(400, "the trusted person must use a separate household");
      }
      return;
    case "phone.release":
      // Nothing is installed on a phone that never paired, so there is nothing to release.
      if (phone.pairedAt === null) throw new ChangeError(400, "this phone has not paired yet; remove it instead");
      return;
    case "setting.set": {
      if (!isSettingKey(op.key)) throw new ChangeError(400, "unknown setting");
      const checked = checkSetting(op.key, op.setting);
      if (!checked.ok) throw new ChangeError(400, checked.error);
      return;
    }
    case "home.set":
      if (!homeUpdateInput.safeParse(op.home).success) throw new ChangeError(400, "invalid home screen");
      return;
    case "timeLimit.set":
    case "timeLimit.bonus": {
      if (op.type === "timeLimit.bonus") {
        // Extra time only means something where there is a limit.
        const [limit] = await db
          .select({ p: timeLimits.packageName })
          .from(timeLimits)
          .where(and(eq(timeLimits.phoneId, phone.id), eq(timeLimits.packageName, op.packageName)));
        if (!limit) throw new ChangeError(400, "there is no limit to give extra time on");
      }
      if (op.packageName === TOTAL) return;
      const [app] = await db
        .select()
        .from(phoneApps)
        .where(and(eq(phoneApps.phoneId, phone.id), eq(phoneApps.packageName, op.packageName)));
      if (!app) {
        // A copied per-app limit can already exist before the new phone reports any apps.
        const [copiedLimit] = op.type === "timeLimit.set" ? await db.select({ p: timeLimits.packageName }).from(timeLimits)
          .where(and(eq(timeLimits.phoneId, phone.id), eq(timeLimits.packageName, op.packageName))) : [];
        if (!copiedLimit) throw new ChangeError(404, "app not reported by this phone");
      }
      // Core apps (dialer, messages, maps, clock, settings...) must always work.
      if (app?.core) throw new ChangeError(400, "core apps such as the dialer cannot have a time limit");
      return;
    }
    case "catalog.add": {
      const country = phoneCountry(phone.timezone);
      const entry = country ? getCatalog(country)?.apps.find((a) => a.packageName === op.packageName) : undefined;
      if (!entry) throw new ChangeError(404, "this app is not in the catalog for this phone");
      return;
    }
    default:
      return;
  }
}

/**
 * Deletes a phone with everything that hangs on it. The DNS tombstone is written in the same
 * transaction as the delete, so the sweeper can retry until the DNS service has forgotten
 * the ClientID. Returns the ClientID, or null when the phone was already gone.
 */
export async function deletePhone(db: DbLike, phoneId: string): Promise<string | null> {
  const [gone] = await db.delete(phones).where(eq(phones.id, phoneId)).returning({ clientId: phones.dnsClientId });
  if (!gone) return null;
  await queueDnsDeletions(db, [gone.clientId]);
  return gone.clientId;
}

/** Applies an op. Idempotent where it can be, since a delayed op may meet a changed state. */
export async function applyOp(ctx: Ctx, db: DbLike, phone: Phone, op: Op, bonusDate?: string): Promise<{ dns: boolean }> {
  switch (op.type) {
    case "move.allow":
      await db.update(phones).set({ allowServerMove: op.allowed }).where(eq(phones.id, phone.id));
      if (!op.allowed) {
        await db.update(phoneMoves).set({ active: false }).where(and(eq(phoneMoves.phoneId, phone.id), eq(phoneMoves.direction, "outgoing")));
        await db.update(pendingChanges).set({ status: "cancelled", decidedAt: ctx.now() }).where(and(
          eq(pendingChanges.phoneId, phone.id), eq(pendingChanges.status, "pending"),
          sql`${pendingChanges.op}->>'type' in ('move.allow', 'move.start')`,
        ));
      }
      return { dns: false };
    case "move.start":
      try { await activateMove(ctx, db, phone, op.exportId); }
      catch (err) {
        if (err instanceof MoveError) throw new ChangeError(409, err.message);
        throw err;
      }
      return { dns: false };

    case "app.set":
      await db
        .update(phoneApps)
        .set({ allowed: op.allowed, explicitlyBlocked: !op.allowed })
        .where(and(eq(phoneApps.phoneId, phone.id), eq(phoneApps.packageName, op.packageName)));
      return { dns: false };
    case "contact.add":
      await db
        .insert(contacts)
        .values({ phoneId: phone.id, name: op.name, number: op.number })
        .onConflictDoUpdate({ target: [contacts.phoneId, contacts.number], set: { name: op.name } });
      return { dns: false };
    case "contact.schedule":
      await db.update(phones).set({ selfScheduleContacts: op.restricted }).where(eq(phones.id, phone.id));
      return { dns: false };
    case "contact.remove":
      await db.delete(contacts).where(and(eq(contacts.id, op.contactId), eq(contacts.phoneId, phone.id)));
      return { dns: false };
    case "dns.method":
      await db.update(phones).set({ filterMethod: op.method }).where(eq(phones.id, phone.id));
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
      await db.delete(householdInvites).where(eq(householdInvites.trustedPhoneId, phone.id));
      await db.update(pendingChanges).set({ awaitingQrHelper: false }).where(and(
        eq(pendingChanges.phoneId, phone.id), eq(pendingChanges.awaitingQrHelper, true),
      ));
      if (!values.trustedUserId) {
        await db.update(pendingChanges).set({
          keyType: "delay",
          effectiveAt: new Date(ctx.now().getTime() + k.delayHours * 3_600_000),
        }).where(and(eq(pendingChanges.phoneId, phone.id), eq(pendingChanges.status, "pending"), eq(pendingChanges.keyType, "trusted")));
      }
      return { dns: false };
    }
    case "setting.set": {
      // One statement, so two changes to different settings never overwrite each other.
      // The object only holds settings that are not free.
      const key = op.key;
      const { setting } = op;
      if (setting.mode === "free") {
        await db
          .insert(phoneSettings)
          .values({ phoneId: phone.id })
          .onConflictDoUpdate({ target: phoneSettings.phoneId, set: { settings: sql`${phoneSettings.settings} - ${key}::text` } });
      } else {
        const stored = { mode: setting.mode, ...(setting.value === undefined ? {} : { value: setting.value }) };
        await db
          .insert(phoneSettings)
          .values({ phoneId: phone.id, settings: { [key]: stored } })
          .onConflictDoUpdate({
            target: phoneSettings.phoneId,
            set: { settings: sql`${phoneSettings.settings} || ${JSON.stringify({ [key]: stored })}::jsonb` },
          });
      }
      return { dns: false };
    }
    case "home.set":
      await db
        .insert(phoneSettings)
        .values({ phoneId: phone.id, home: op.home })
        .onConflictDoUpdate({
          target: phoneSettings.phoneId,
          set: { home: sql`${phoneSettings.home} || ${JSON.stringify(op.home)}::jsonb` },
        });
      return { dns: false };
    case "phone.remove":
      await deletePhone(db, phone.id);
      return { dns: false };
    case "phone.release":
      // The phone is woken by the caller (see submitChange). It switches Plainphone off and
      // then calls POST /device/released, which deletes the phone (see deletePhone).
      await db.update(phones).set({ releaseRequestedAt: ctx.now() }).where(eq(phones.id, phone.id));
      return { dns: false };
    case "timeLimit.set": {
      const where = and(eq(timeLimits.phoneId, phone.id), eq(timeLimits.packageName, op.packageName));
      if (!op.limit) {
        await db.delete(timeLimits).where(where);
        return { dns: false };
      }
      if (op.packageName !== TOTAL) {
        // A delayed change may meet an app that has since been reported as core.
        const [app] = await db
          .select({ core: phoneApps.core })
          .from(phoneApps)
          .where(and(eq(phoneApps.phoneId, phone.id), eq(phoneApps.packageName, op.packageName)));
        if (app?.core) throw new ChangeError(400, "core apps such as the dialer cannot have a time limit");
      }
      const values = { minutes: op.limit.minutes, days: op.limit.days };
      await db
        .insert(timeLimits)
        .values({ phoneId: phone.id, packageName: op.packageName, ...values })
        .onConflictDoUpdate({ target: [timeLimits.phoneId, timeLimits.packageName], set: values });
      return { dns: false };
    }
    case "timeLimit.bonus":
      // The day is decided when the bonus takes effect, not when it was asked for: on a
      // Self phone it may wait 24 hours or more, and yesterday's bonus is never sent.
      await db.insert(timeBonuses).values({
        phoneId: phone.id,
        packageName: op.packageName,
        day: bonusDate ?? localDate(phone.timezone, ctx.now()),
        minutes: op.minutes,
      });
      return { dns: false };
    case "catalog.add":
      // A new row is not installed yet; an existing row keeps its installed flag and label.
      await db
        .insert(phoneApps)
        .values({
          phoneId: phone.id,
          packageName: op.packageName,
          label: op.label,
          allowed: true,
          requested: true,
          installed: false,
          reportedAt: ctx.now(),
        })
        .onConflictDoUpdate({
          target: [phoneApps.phoneId, phoneApps.packageName],
          set: { allowed: true, requested: true, explicitlyBlocked: false },
        });
      return { dns: false };
    case "catalog.remove":
      await db
        .update(phoneApps)
        .set({ requested: false, allowed: false, explicitlyBlocked: true })
        .where(and(eq(phoneApps.phoneId, phone.id), eq(phoneApps.packageName, op.packageName)));
      return { dns: false };
  }
}

/** Side effects outside the database, after an op has been applied. */
async function afterApply(ctx: Ctx, op: Op, requestedBy: string | null) {
  if (op.type === "phone.remove") {
    // Failures stay queued in dns_deletions and the sweeper retries them.
    await retryDnsDeletions(ctx, [op.dnsClientId]);
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
export async function submitChange(
  ctx: Ctx, phone: Phone, userId: string, op: Op, deviceFavourite = false,
): Promise<ChangeResult> {
  const result = await ctx.db.transaction(async (tx) => {
    // Serialise changes per phone, so loosening checks see a stable state.
    const [fresh] = await tx.select().from(phones).where(eq(phones.id, phone.id)).for("update");
    if (!fresh) throw new ChangeError(404, "phone not found");
    await validateOp(tx, fresh, op);
    let unrestrictedFavourite = false;
    if (deviceFavourite && op.type === "contact.add") {
      const [known] = await tx.select({ id: contacts.id }).from(contacts)
        .where(and(eq(contacts.phoneId, phone.id), eq(contacts.number, op.number)));
      if (known) return { status: "applied" as const, op, dns: false };
      unrestrictedFavourite = fresh.selfScheduleContacts === false;
      const [queued] = await tx.select().from(pendingChanges).where(and(
        eq(pendingChanges.phoneId, phone.id), eq(pendingChanges.status, "pending"),
        sql`${pendingChanges.op}->>'type' = 'contact.add' and ${pendingChanges.op}->>'number' = ${op.number}`,
      ));
      if (queued) return { status: "pending" as const, op, change: queued, notify: null };
    }
    const connected = fresh.pairedAt !== null || fresh.deviceTokenHash !== null;
    if (fresh.profile === "self" && !unrestrictedFavourite && connected && (await isLoosening(tx, fresh, op))) {
      const [key] = await tx.select().from(selfKeys).where(eq(selfKeys.phoneId, phone.id));
      // An unavailable helper leaves the delay as a way to change the key.
      const helperId = key?.keyType === "trusted" ? key.trustedUserId : null;
      const helperIsSeparate = helperId && helperId !== userId && !(await isPhoneHouseholdMember(tx, fresh, helperId));
      const keyType = helperIsSeparate ? "trusted" : "delay";
      const delayHours = key?.delayHours ?? 24;
      const [change] = await tx
        .insert(pendingChanges)
        .values({
          phoneId: phone.id,
          requestedBy: userId,
          op,
          keyType,
          awaitingQrHelper: key?.keyType === "trusted" && !key.trustedUserId && !key.trustedEmail,
          effectiveAt: keyType === "delay" ? new Date(ctx.now().getTime() + delayHours * 3_600_000) : null,
        })
        .returning();
      const notify = keyType === "trusted" ? helperId : null;
      return { status: "pending" as const, op, change: change!, notify };
    }
    const applied = await applyOp(ctx, tx, fresh, op);
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
  if (notify) {
    await mailTrustedPerson(ctx, notify, phone.name);
    await notifyUsers(ctx, [notify], { type: "approval", phoneName: phone.name }, { respectMuteFor: phone.id });
  }
  return pending;
}

/** Tells the trusted person that a request waits for them. A failed mail never fails the change. */
async function mailTrustedPerson(ctx: Ctx, trustedUserId: string, phoneName: string) {
  if (!ctx.mail.canSend) return;
  try {
    const [person] = await ctx.db
      .select({ email: users.email, locale: users.locale })
      .from(users)
      .where(eq(users.id, trustedUserId));
    if (!person) return;
    await ctx.mail.send(approvalRequestMail(person.email, toLocale(person.locale), ctx.cfg.PUBLIC_URL, phoneName));
  } catch (err) {
    console.error(`could not mail the trusted person about a request: ${(err as Error).message}`);
  }
}

/** A helper cannot manage the same phone or decide a request they submitted. */
export async function canDecideTrusted(db: DbLike, phone: Phone, change: typeof pendingChanges.$inferSelect, userId: string) {
  if (phone.profile !== "self" || change.keyType !== "trusted" || change.requestedBy === userId) return false;
  const [key] = await db.select().from(selfKeys).where(eq(selfKeys.phoneId, phone.id));
  if (key?.keyType !== "trusted" || key.trustedUserId !== userId) return false;
  return !(await isPhoneHouseholdMember(db, phone, userId));
}

async function isPhoneHouseholdMember(db: DbLike, phone: Phone, userId: string) {
  const [member] = await db.select({ userId: householdMembers.userId }).from(householdMembers)
    .where(and(eq(householdMembers.householdId, phone.householdId), eq(householdMembers.userId, userId)));
  return Boolean(member);
}

export async function rejectTrustedChange(ctx: Ctx, changeId: string, phoneId: string, helper: string) {
  const rejected = await ctx.db.transaction(async (tx) => {
    const [phone] = await tx.select().from(phones).where(eq(phones.id, phoneId)).for("update");
    if (!phone) return false;
    const [change] = await tx.select().from(pendingChanges).where(and(
      eq(pendingChanges.id, changeId), eq(pendingChanges.phoneId, phoneId), eq(pendingChanges.status, "pending"),
    )).for("update");
    if (!change || !(await canDecideTrusted(tx, phone, change, helper))) return false;
    await tx.update(pendingChanges).set({ status: "rejected", decidedBy: helper, decidedAt: ctx.now() })
      .where(eq(pendingChanges.id, change.id));
    return true;
  });
  if (rejected) await wakePhone(ctx, phoneId, "rules");
  return rejected;
}

/** Applies a pending change now (delay passed, trusted person approved, or paid). */
export async function applyPending(
  ctx: Ctx,
  changeId: string,
  decidedBy: string | null,
  approval?: { revision: string; challenge?: string },
): Promise<"applied" | "gone"> {
  const out = await ctx.db.transaction(async (tx) => {
    const [target] = await tx.select({ phoneId: pendingChanges.phoneId }).from(pendingChanges)
      .where(eq(pendingChanges.id, changeId));
    if (!target) return null;
    const [phone] = await tx.select().from(phones).where(eq(phones.id, target.phoneId)).for("update");
    if (!phone) return null;
    const [change] = await tx
      .select()
      .from(pendingChanges)
      .where(and(eq(pendingChanges.id, changeId), eq(pendingChanges.status, "pending")))
      .for("update");
    if (!change) return null;
    const now = ctx.now();
    const op = change.op as Op;
    const bonusDate = op.type === "timeLimit.bonus" ? approvalBonusDate(phone, now) : undefined;
    if (decidedBy) {
      if (!(await canDecideTrusted(tx, phone, change, decidedBy))) return null;
      if (!approval) return null;
      const state = await loadApprovalSummaries(tx, [{ phoneId: phone.id, op }]);
      const revision = approvalRevision(change, state, phone.id, op, bonusDate);
      if (approval.revision !== revision) return null;
      if (approval.challenge !== undefined &&
          !matchesApprovalChallenge(approval.challenge, decidedBy, revision, change.approvalChallengeHash, now)) return null;
    } else if (change.keyType !== "delay" || !change.effectiveAt || change.effectiveAt > now) return null;
    let dns = false;
    let status: "applied" | "failed" = "applied";
    try {
      // A savepoint, so a failed op (e.g. its target was deleted meanwhile) does not
      // abort the outer transaction that marks the change as handled.
      dns = (await tx.transaction((sp) => applyOp(ctx, sp, phone, op, bonusDate))).dns;
    } catch (err) {
      console.error(`pending change ${change.id} could not be applied`, err);
      status = "failed";
    }
    await tx
      .update(pendingChanges)
      .set({ status, decidedBy, decidedAt: ctx.now(), approvalChallengeHash: null })
      .where(eq(pendingChanges.id, change.id));
    return { phoneId: phone.id, dns, op: change.op as Op, requestedBy: change.requestedBy, status };
  });
  if (!out) return "gone";
  if (out.dns) await syncDns(ctx, out.phoneId);
  if (out.status === "applied") await afterApply(ctx, out.op, out.requestedBy);
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
