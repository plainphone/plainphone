// SPDX-License-Identifier: Apache-2.0
//
// Extended family contacts and location snapshots (docs/extended-family.md).
//
// An extended contact is a named person (a grandparent, an older sibling) a parent invites with a
// single-use link. They become a member only when the child has said yes on the phone AND the
// person has accepted the link. They get no account: the link gives their browser a session that
// reaches only their own conversation with the child, never the parents' dashboard, the rules or
// another conversation. The child can block them at any time; a parent can remove them or send a
// new link, which starts the approval over and clears the old conversation.
//
// Only the existing message types travel: the child sends the quick messages the parents approved,
// the contact answers with a short reply (60 characters, like a parent reply). No free text from
// the child until the encryption review (#120) is decided.
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { extendedContacts, extendedMessages, familyMessages, locationSnapshots, phones } from "../db/schema.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import type { Ctx } from "./context.js";
import { inboxSwitches, snapshotJson } from "./family-inbox.js";

type Phone = typeof phones.$inferSelect;
type Contact = typeof extendedContacts.$inferSelect;
type Message = typeof extendedMessages.$inferSelect;
export type ContactGroup = Contact["contactGroup"];

export const INVITE_PREFIX = "pp_fi_";
export const SESSION_PREFIX = "pp_fc_";
/** A link is valid for a week; the parent can send a new one. */
const INVITE_MS = 7 * 86_400_000;
/** Most extended contacts a phone has, counting pending invitations. */
export const CONTACTS_MAX = 10;
export const NAME_MAX = 40;
/** A reply from a contact is as short as a parent's. */
export const CONTACT_REPLY_MAX = 60;
/** Replies a contact can send in an hour; more are refused (429). */
const REPLY_LIMIT = 20;
const THREAD_KEEP = 50;
export const THREAD_SHOWN = 30;
const KEEP_MS = 30 * 86_400_000;
/** A location snapshot can be seen for one hour after the child sent it. */
export const SNAPSHOT_MS = 60 * 60_000;
/** Declined and expired invitations stay on the parents' list this long. */
const ENDED_KEEP_MS = 30 * 86_400_000;

export type ContactStatus =
  | "waitingForChild" | "waitingForContact" | "active" | "blocked"
  | "declinedByChild" | "declinedByContact" | "expired";

export function contactStatus(c: Contact, now: Date): ContactStatus {
  if (c.blockedAt) return "blocked";
  if (c.childDeclinedAt) return "declinedByChild";
  if (c.contactDeclinedAt) return "declinedByContact";
  if (!c.acceptedAt && (!c.inviteExpiresAt || c.inviteExpiresAt <= now)) return "expired";
  if (!c.childApprovedAt) return "waitingForChild";
  if (!c.acceptedAt) return "waitingForContact";
  return "active";
}

/** The parts that are on for the child right now. Everything needs the family inbox. */
export function extendedSwitches(phone: Phone) {
  const inbox = inboxSwitches(phone);
  const on = inbox.familyInbox && !phone.releaseRequestedAt;
  return {
    extendedFamily: on && phone.extendedFamilyEnabled,
    locationSnapshots: on && phone.locationSnapshotsEnabled,
    quickMessages: inbox.quickMessages,
  };
}

export class ExtendedError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 410 | 429, message: string) {
    super(message);
  }
}

export function contactJson(c: Contact, now: Date) {
  const status = contactStatus(c, now);
  return {
    id: c.id,
    name: c.name,
    group: c.contactGroup,
    status,
    childApproved: c.childApprovedAt !== null,
    contactAccepted: c.acceptedAt !== null,
    linkExpiresAt: status === "waitingForChild" || status === "waitingForContact" ? c.inviteExpiresAt : null,
    createdAt: c.createdAt,
  };
}

export async function listContacts(db: Ctx["db"], phoneId: string) {
  return db.select().from(extendedContacts).where(eq(extendedContacts.phoneId, phoneId))
    .orderBy(asc(extendedContacts.createdAt), asc(extendedContacts.id));
}

function inviteUrl(ctx: Ctx, token: string) {
  return `${ctx.cfg.PUBLIC_URL.replace(/\/$/, "")}/family#invite=${token}`;
}

/** A parent invites a named person. The link is shown once; only its hash is kept. */
export async function inviteContact(ctx: Ctx, phone: Phone, userId: string, name: string) {
  if (!extendedSwitches(phone).extendedFamily) throw new ExtendedError(403, "extended family contacts are off for this phone");
  return ctx.db.transaction(async (tx) => {
    await tx.select({ id: phones.id }).from(phones).where(eq(phones.id, phone.id)).for("update");
    const rows = await tx.select().from(extendedContacts).where(eq(extendedContacts.phoneId, phone.id));
    const now = ctx.now();
    const counted = rows.filter((r) => !["declinedByChild", "declinedByContact", "expired"].includes(contactStatus(r, now)));
    if (counted.length >= CONTACTS_MAX) throw new ExtendedError(409, "a phone has at most ten extended contacts");
    const token = randomToken(INVITE_PREFIX);
    const expiresAt = new Date(now.getTime() + INVITE_MS);
    const [row] = await tx.insert(extendedContacts).values({
      phoneId: phone.id, name, invitedBy: userId, inviteTokenHash: sha256(token), inviteExpiresAt: expiresAt, createdAt: now,
    }).returning();
    return { contact: row!, link: inviteUrl(ctx, token), expiresAt };
  });
}

/**
 * A new single-use link for the same person, for a lost link, a new device or an expired invitation.
 * The old session and the old conversation end, and the child has to say yes again: from the
 * child's side a new link is a new device, and it may not be the same person holding it.
 */
export async function renewLink(ctx: Ctx, phone: Phone, contactId: string) {
  if (!extendedSwitches(phone).extendedFamily) throw new ExtendedError(403, "extended family contacts are off for this phone");
  const now = ctx.now();
  const token = randomToken(INVITE_PREFIX);
  const expiresAt = new Date(now.getTime() + INVITE_MS);
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx.select().from(extendedContacts)
      .where(and(eq(extendedContacts.phoneId, phone.id), eq(extendedContacts.id, contactId))).for("update");
    if (!row) throw new ExtendedError(404, "contact not found");
    const status = contactStatus(row, now);
    if (status === "blocked" || status === "declinedByChild") {
      throw new ExtendedError(409, "the child said no to this person; remove them and invite again");
    }
    const [updated] = await tx.update(extendedContacts).set({
      inviteTokenHash: sha256(token), inviteExpiresAt: expiresAt, sessionTokenHash: null,
      acceptedAt: null, contactDeclinedAt: null, childApprovedAt: null, rev: sql`${extendedContacts.rev} + 1`,
    }).where(eq(extendedContacts.id, row.id)).returning();
    await tx.delete(extendedMessages).where(eq(extendedMessages.contactId, row.id));
    await tx.delete(locationSnapshots).where(eq(locationSnapshots.contactId, row.id));
    return { contact: updated!, link: inviteUrl(ctx, token), expiresAt };
  });
}

export async function setContactGroup(ctx: Ctx, phoneId: string, contactId: string, group: ContactGroup) {
  const [row] = await ctx.db.update(extendedContacts).set({ contactGroup: group })
    .where(and(eq(extendedContacts.phoneId, phoneId), eq(extendedContacts.id, contactId))).returning();
  if (!row) throw new ExtendedError(404, "contact not found");
  return row;
}

/** A parent removes a person. Their session, conversation and any snapshot go with them. */
export async function removeContact(ctx: Ctx, phoneId: string, contactId: string) {
  const [row] = await ctx.db.delete(extendedContacts)
    .where(and(eq(extendedContacts.phoneId, phoneId), eq(extendedContacts.id, contactId))).returning();
  if (!row) throw new ExtendedError(404, "contact not found");
}

// --- The child's phone ---------------------------------------------------------------------------

/** What the phone shows on its roster: everyone the child has to answer, waits for, talks to or blocked. */
const ON_ROSTER: ContactStatus[] = ["waitingForChild", "waitingForContact", "active", "blocked"];

/**
 * The rules' `extended` block, left out while the feature is off. `rev` changes whenever the
 * phone should fetch that conversation again.
 */
export async function extendedRules(ctx: Ctx, phone: Phone) {
  const sw = extendedSwitches(phone);
  if (!sw.extendedFamily) return undefined;
  const now = ctx.now();
  const rows = await listContacts(ctx.db, phone.id);
  return {
    enabled: true,
    quickMessages: sw.quickMessages,
    contacts: rows.filter((r) => ON_ROSTER.includes(contactStatus(r, now))).map((r) => ({
      id: r.id, name: r.name, status: contactStatus(r, now), group: r.contactGroup, rev: r.rev,
    })),
  };
}

/** The rules' `locationSnapshot` block, left out while snapshots are off. */
export function snapshotRules(phone: Phone) {
  return extendedSwitches(phone).locationSnapshots ? { enabled: true, minutes: SNAPSHOT_MS / 60_000 } : undefined;
}

async function phoneContact(ctx: Ctx, phoneId: string, contactId: string) {
  const [row] = await ctx.db.select().from(extendedContacts)
    .where(and(eq(extendedContacts.phoneId, phoneId), eq(extendedContacts.id, contactId)));
  return row;
}

/** The child says yes or no to an invitation. Saying the same thing again changes nothing. */
export async function answerInvite(ctx: Ctx, phone: Phone, contactId: string, allow: boolean) {
  const now = ctx.now();
  const row = await phoneContact(ctx, phone.id, contactId);
  if (!row) throw new ExtendedError(404, "contact not found");
  const status = contactStatus(row, now);
  if (allow && row.childApprovedAt) return;
  if (!allow && row.childDeclinedAt) return;
  if (status !== "waitingForChild") throw new ExtendedError(409, `cannot answer a contact that is ${status}`);
  await ctx.db.update(extendedContacts).set(allow
    ? { childApprovedAt: now }
    : { childDeclinedAt: now, inviteTokenHash: null, sessionTokenHash: null })
    .where(eq(extendedContacts.id, row.id));
}

/**
 * The child blocks a person: their link and session stop working at once and nothing more reaches
 * the phone. Only a parent's removal and a new invitation, which the child must approve, undo it.
 */
export async function blockContact(ctx: Ctx, phone: Phone, contactId: string) {
  const row = await phoneContact(ctx, phone.id, contactId);
  if (!row) throw new ExtendedError(404, "contact not found");
  if (row.blockedAt) return;
  await ctx.db.update(extendedContacts)
    .set({ blockedAt: ctx.now(), inviteTokenHash: null, sessionTokenHash: null })
    .where(eq(extendedContacts.id, row.id));
  await ctx.db.delete(locationSnapshots).where(eq(locationSnapshots.contactId, row.id));
}

export type ChildSendAnswer = { stored: true } | { stored: false; gone: true };

/**
 * A quick message the child sent to a contact. The phone is the authority for what it has sent:
 * it is recorded while the person is still a member, even if a switch changed on the way. If the
 * person was removed, blocked or never became a member, there is nobody to keep it for, and the
 * phone is told (`gone`) so it can say "Not delivered".
 */
export async function recordChildToContact(
  ctx: Ctx, phone: Phone, contactId: string, input: { id: string; text: string; sentAt?: Date; kind?: "quick" | "snapshot" },
): Promise<ChildSendAnswer> {
  const now = ctx.now();
  const row = await phoneContact(ctx, phone.id, contactId);
  if (!row || contactStatus(row, now) !== "active") return { stored: false, gone: true };
  const sentAt = input.sentAt && input.sentAt < now ? input.sentAt : now;
  const [inserted] = await ctx.db.insert(extendedMessages).values({
    contactId, id: input.id, sender: "child", kind: input.kind ?? "quick", text: input.text, sentAt, createdAt: now,
  }).onConflictDoNothing().returning();
  if (inserted) await trimContactThread(ctx, contactId);
  return { stored: true };
}

/** The phone has fetched these replies. Advances `rev` only when something changed. */
export async function childReceived(ctx: Ctx, phone: Phone, contactId: string, ids: string[]) {
  if (ids.length === 0) return;
  const row = await phoneContact(ctx, phone.id, contactId);
  if (!row) return;
  await ctx.db.update(extendedMessages).set({ receivedAt: ctx.now() }).where(and(
    eq(extendedMessages.contactId, contactId), inArray(extendedMessages.id, ids),
    eq(extendedMessages.sender, "contact"), isNull(extendedMessages.receivedAt),
  ));
}

async function listThread(db: Ctx["db"], contactId: string) {
  const rows = await db.select().from(extendedMessages).where(eq(extendedMessages.contactId, contactId))
    .orderBy(desc(extendedMessages.sentAt), desc(extendedMessages.createdAt)).limit(THREAD_SHOWN);
  return rows.reverse();
}

async function trimContactThread(ctx: Ctx, contactId: string) {
  const keep = ctx.db.select({ id: extendedMessages.id }).from(extendedMessages)
    .where(eq(extendedMessages.contactId, contactId))
    .orderBy(desc(extendedMessages.sentAt), desc(extendedMessages.createdAt)).limit(THREAD_KEEP);
  await ctx.db.delete(extendedMessages).where(and(eq(extendedMessages.contactId, contactId), notInArray(extendedMessages.id, keep)));
}

type Snapshot = typeof locationSnapshots.$inferSelect;

/** The live snapshot of a phone, if it has not expired. */
async function liveSnapshot(ctx: Ctx, phoneId: string): Promise<Snapshot | undefined> {
  const [row] = await ctx.db.select().from(locationSnapshots)
    .where(and(eq(locationSnapshots.phoneId, phoneId), gt(locationSnapshots.expiresAt, ctx.now())));
  return row;
}

/** A message as the reader sees it. A snapshot carries its position only while it is live and theirs. */
export function contactMessageJson(m: Message, snapshot: Snapshot | undefined) {
  return {
    id: m.id,
    from: m.sender,
    kind: m.kind,
    text: m.text,
    sentAt: m.sentAt,
    receivedAt: m.receivedAt,
    ...(m.kind === "snapshot"
      ? { location: snapshot && snapshot.messageId === m.id && snapshot.contactId === m.contactId ? snapshotJson(snapshot) : null }
      : {}),
  };
}

/** The conversation with one contact, for the child's phone. */
export async function childThread(ctx: Ctx, phone: Phone, contactId: string) {
  const row = await phoneContact(ctx, phone.id, contactId);
  if (!row || !ON_ROSTER.includes(contactStatus(row, ctx.now()))) throw new ExtendedError(404, "contact not found");
  const [messages, snapshot] = await Promise.all([listThread(ctx.db, row.id), liveSnapshot(ctx, phone.id)]);
  return {
    contact: { id: row.id, name: row.name, status: contactStatus(row, ctx.now()), rev: row.rev },
    messages: messages.map((m) => contactMessageJson(m, snapshot)),
  };
}

// --- The contact's own page ----------------------------------------------------------------------

/** What the invitation page shows before the person accepts. Does not use the link up. */
export async function previewInvite(ctx: Ctx, token: string) {
  const row = await inviteRow(ctx, token);
  const [phone] = await ctx.db.select({ name: phones.name }).from(phones).where(eq(phones.id, row.phoneId));
  return { childName: phone?.name ?? "", contactName: row.name, childApproved: row.childApprovedAt !== null, expiresAt: row.inviteExpiresAt };
}

async function inviteRow(ctx: Ctx, token: string) {
  if (!token.startsWith(INVITE_PREFIX)) throw new ExtendedError(404, "invitation not found");
  const [row] = await ctx.db.select().from(extendedContacts).where(eq(extendedContacts.inviteTokenHash, sha256(token)));
  if (!row) throw new ExtendedError(404, "invitation not found");
  const status = contactStatus(row, ctx.now());
  if (status === "expired") throw new ExtendedError(410, "this invitation has expired");
  if (status !== "waitingForChild" && status !== "waitingForContact") throw new ExtendedError(404, "invitation not found");
  return row;
}

/**
 * The person accepts: the link is used up and their browser gets a session. Accepting twice with
 * the same link (a replay) finds nothing.
 */
export async function acceptInvite(ctx: Ctx, token: string) {
  const row = await inviteRow(ctx, token);
  const session = randomToken(SESSION_PREFIX);
  const [updated] = await ctx.db.update(extendedContacts).set({
    inviteTokenHash: null, sessionTokenHash: sha256(session), acceptedAt: ctx.now(), rev: sql`${extendedContacts.rev} + 1`,
  }).where(and(eq(extendedContacts.id, row.id), eq(extendedContacts.inviteTokenHash, sha256(token)))).returning();
  if (!updated) throw new ExtendedError(404, "invitation not found");
  return { session, contact: updated };
}

export async function declineInvite(ctx: Ctx, token: string) {
  const row = await inviteRow(ctx, token);
  await ctx.db.update(extendedContacts).set({ inviteTokenHash: null, contactDeclinedAt: ctx.now() })
    .where(eq(extendedContacts.id, row.id));
  return row;
}

/** The person behind a session, with their phone. Only a member (accepted, not blocked) has one. */
export async function sessionContact(ctx: Ctx, token: string) {
  if (!token.startsWith(SESSION_PREFIX)) return null;
  const [row] = await ctx.db.select({ contact: extendedContacts, phone: phones }).from(extendedContacts)
    .innerJoin(phones, eq(phones.id, extendedContacts.phoneId))
    .where(and(eq(extendedContacts.sessionTokenHash, sha256(token)), isNotNull(extendedContacts.acceptedAt), isNull(extendedContacts.blockedAt)));
  return row ?? null;
}

/** What the person's page shows: the child's name, the state and their conversation. Marks the child's messages received. */
export async function contactView(ctx: Ctx, contact: Contact, phone: Phone) {
  const now = ctx.now();
  const status = contactStatus(contact, now);
  const sw = extendedSwitches(phone);
  const paused = !sw.extendedFamily;
  const [messages, snapshot] = await Promise.all([listThread(ctx.db, contact.id), liveSnapshot(ctx, phone.id)]);
  const unread = messages.filter((m) => m.sender === "child" && !m.receivedAt).map((m) => m.id);
  if (unread.length) {
    await ctx.db.update(extendedMessages).set({ receivedAt: now })
      .where(and(eq(extendedMessages.contactId, contact.id), inArray(extendedMessages.id, unread)));
    await ctx.db.update(extendedContacts).set({ rev: sql`${extendedContacts.rev} + 1` }).where(eq(extendedContacts.id, contact.id));
  }
  return {
    childName: phone.name,
    name: contact.name,
    status,
    paused,
    canReply: status === "active" && !paused,
    messages: messages.map((m) => contactMessageJson(m, snapshot)),
    woke: unread.length > 0,
  };
}

export async function contactReply(ctx: Ctx, contact: Contact, phone: Phone, text: string) {
  const now = ctx.now();
  if (contactStatus(contact, now) !== "active") throw new ExtendedError(403, `${phone.name} has not said yes yet`);
  if (!extendedSwitches(phone).extendedFamily) throw new ExtendedError(403, "paused by the parents");
  const recent = await ctx.db.select({ id: extendedMessages.id }).from(extendedMessages).where(and(
    eq(extendedMessages.contactId, contact.id), eq(extendedMessages.sender, "contact"),
    gt(extendedMessages.createdAt, new Date(now.getTime() - 3_600_000)),
  ));
  if (recent.length >= REPLY_LIMIT) throw new ExtendedError(429, "too many messages; try again later");
  const [row] = await ctx.db.insert(extendedMessages).values({
    contactId: contact.id, id: crypto.randomUUID(), sender: "contact", kind: "reply", text, sentAt: now, createdAt: now,
  }).returning();
  await ctx.db.update(extendedContacts).set({ rev: sql`${extendedContacts.rev} + 1` }).where(eq(extendedContacts.id, contact.id));
  await trimContactThread(ctx, contact.id);
  return row!;
}

/** The person leaves: as if a parent removed them. */
export async function leave(ctx: Ctx, contact: Contact) {
  await ctx.db.delete(extendedContacts).where(eq(extendedContacts.id, contact.id));
}

// --- Location snapshots --------------------------------------------------------------------------

export interface SnapshotInput {
  id: string;
  /** `parents`, or the id of an extended contact. */
  to: string;
  lat: number;
  lon: number;
  accuracyM?: number | null;
  recordedAt: Date;
  sentAt?: Date;
}

/**
 * A location snapshot the child confirmed and the phone sent. The message is always recorded in the
 * recipient's conversation (the phone is the authority for what it sent). The position is kept only
 * while snapshots are still switched on, only for that recipient, and only until it expires; a newer
 * snapshot replaces it, as the location feature keeps one position (docs/location.md).
 */
export async function recordSnapshot(ctx: Ctx, phone: Phone, input: SnapshotInput, text: string) {
  const now = ctx.now();
  const sentAt = input.sentAt && input.sentAt < now ? input.sentAt : now;
  const expiresAt = new Date(sentAt.getTime() + SNAPSHOT_MS);
  let contactId: string | null = null;
  if (input.to === "parents") {
    await ctx.db.insert(familyMessages).values({
      phoneId: phone.id, id: input.id, sender: "child", kind: "snapshot", text, sentAt, createdAt: now,
    }).onConflictDoNothing();
  } else {
    const answer = await recordChildToContact(ctx, phone, input.to, { id: input.id, text, sentAt, kind: "snapshot" });
    if (!answer.stored) return { stored: false as const, kept: false, gone: true as const };
    contactId = input.to;
    await ctx.db.update(extendedContacts).set({ rev: sql`${extendedContacts.rev} + 1` }).where(eq(extendedContacts.id, contactId));
  }
  const kept = extendedSwitches(phone).locationSnapshots && expiresAt > now;
  if (kept) {
    const values = {
      messageId: input.id, contactId, lat: input.lat, lon: input.lon, accuracyM: input.accuracyM ?? null,
      recordedAt: input.recordedAt, expiresAt, createdAt: now,
    };
    // A retry of an older snapshot never replaces a newer one.
    await ctx.db.insert(locationSnapshots).values({ phoneId: phone.id, ...values })
      .onConflictDoUpdate({ target: locationSnapshots.phoneId, set: values, setWhere: lt(locationSnapshots.expiresAt, expiresAt) });
  }
  const [live] = await ctx.db.select().from(locationSnapshots).where(eq(locationSnapshots.phoneId, phone.id));
  return { stored: true as const, kept: kept && live?.messageId === input.id, expiresAt, contactId };
}

/** The snapshot for the parents' view of the family inbox, if one is live. */
export async function parentSnapshot(ctx: Ctx, phoneId: string) {
  const row = await liveSnapshot(ctx, phoneId);
  return row && row.contactId === null ? row : undefined;
}

/** Switching snapshots off deletes the stored one, as switching location off does. */
export async function clearSnapshot(ctx: Ctx, phoneId: string) {
  await ctx.db.delete(locationSnapshots).where(eq(locationSnapshots.phoneId, phoneId));
}

/** Sweeper: expired snapshots, old conversation lines, and invitations that ended long ago. */
export async function sweepExtended(ctx: Ctx) {
  const now = ctx.now();
  await ctx.db.delete(locationSnapshots).where(lt(locationSnapshots.expiresAt, now));
  await ctx.db.delete(extendedMessages).where(lt(extendedMessages.createdAt, new Date(now.getTime() - KEEP_MS)));
  const ended = new Date(now.getTime() - ENDED_KEEP_MS);
  await ctx.db.delete(extendedContacts).where(or(
    lt(extendedContacts.childDeclinedAt, ended),
    lt(extendedContacts.contactDeclinedAt, ended),
    and(isNull(extendedContacts.acceptedAt), lt(extendedContacts.inviteExpiresAt, ended)),
  ));
}
