// SPDX-License-Identifier: Apache-2.0
//
// The API the parent app (PWA, later native apps) talks to. Contract: server/openapi.yaml.

import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  contacts,
  dnsSettings,
  householdInvites,
  householdMembers,
  households,
  locations,
  pairings,
  pendingChanges,
  phoneApps,
  phones,
  schedules,
  selfKeys,
  users,
} from "../db/schema.js";
import { normalizePairingCode, randomToken, sha256 } from "../lib/crypto.js";
import { body, clientIp, param, RateLimiter } from "../lib/http.js";
import { inviteMail, toLocale } from "../lib/mail-templates.js";
import * as v from "../lib/validation.js";
import { endSession, requestMagicLink, SESSION_DAYS, userForSession, verifyMagicLink } from "../services/auth.js";
import {
  applyPending,
  ChangeError,
  type ChangeResult,
  listPending,
  type Op,
  submitChange,
} from "../services/changes.js";
import type { Ctx } from "../services/context.js";
import { syncDns } from "../services/dns.js";
import { createPhone, phoneSummary, wakePhone } from "../services/phones.js";
import { DEVICE_PREFIX } from "./device.js";

type User = typeof users.$inferSelect;
type Phone = typeof phones.$inferSelect;
type Env = { Variables: { user: User; viaCookie: boolean } };

export const SESSION_COOKIE = "pp_session";
const INVITE_DAYS = 7;

function changeJson(r: ChangeResult) {
  return r.status === "applied"
    ? { status: "applied" as const }
    : {
        status: "pending" as const,
        change: {
          id: r.change.id,
          op: r.change.op,
          keyType: r.change.keyType,
          effectiveAt: r.change.effectiveAt?.toISOString() ?? null,
        },
      };
}

export function parentRoutes(ctx: Ctx) {
  const app = new Hono<Env>();
  const secureCookie = ctx.cfg.PUBLIC_URL.startsWith("https://");
  const publicOrigin = new URL(ctx.cfg.PUBLIC_URL).origin;
  const loginIpLimit = new RateLimiter(20, 60 * 60_000);
  const loginEmailLimit = new RateLimiter(5, 60 * 60_000);
  const verifyLimit = new RateLimiter(30, 15 * 60_000);
  const claimLimit = new RateLimiter(20, 15 * 60_000);
  const inviteUserLimit = new RateLimiter(20, 24 * 60 * 60_000);
  const inviteRecipientLimit = new RateLimiter(3, 24 * 60 * 60_000);

  // --- Auth -------------------------------------------------------------------

  app.post("/auth/request", async (c) => {
    const input = await body(c, z.object({ email: v.email, locale: v.locale.default("en") }));
    if (!loginIpLimit.take(clientIp(c, ctx.cfg.TRUST_PROXY)) || !loginEmailLimit.take(input.email)) {
      throw new HTTPException(429, { message: "too many login links; try again later" });
    }
    await requestMagicLink(ctx, input.email, input.locale);
    // Same answer whether or not the address is known.
    return c.json({ ok: true, mailEnabled: ctx.mail.canSend }, 202);
  });

  app.post("/auth/verify", async (c) => {
    if (!verifyLimit.take(clientIp(c, ctx.cfg.TRUST_PROXY))) throw new HTTPException(429, { message: "slow down" });
    const input = await body(
      c,
      z.object({
        token: z.string().min(10).max(200),
        locale: v.locale.default("en"),
        /** Native apps ask for the token; the PWA only gets the HttpOnly cookie. */
        client: z.enum(["web", "native"]).default("web"),
      }),
    );
    const out = await verifyMagicLink(ctx, input.token, input.locale);
    if (!out) return c.json({ error: "this link is expired or already used" }, 400);
    setCookie(c, SESSION_COOKIE, out.sessionToken, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: "Strict",
      path: "/api",
      maxAge: SESSION_DAYS * 86_400,
    });
    return c.json({
      user: userJson(out.user),
      ...(input.client === "native" ? { sessionToken: out.sessionToken } : {}),
    });
  });

  // --- Everything below needs a session ---------------------------------------

  app.use("/*", async (c, next) => {
    const auth = c.req.header("authorization") ?? "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (bearer.startsWith(DEVICE_PREFIX)) throw new HTTPException(403, { message: "device tokens cannot use this API" });
    const cookie = getCookie(c, SESSION_COOKIE);
    const token = bearer || cookie || "";
    const user = token ? await userForSession(ctx, token) : null;
    if (!user) throw new HTTPException(401, { message: "sign in first" });
    const viaCookie = !bearer;
    // CSRF: a cookie-authenticated write must come from our own origin.
    if (viaCookie && !["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      const site = c.req.header("sec-fetch-site");
      if (!(origin === publicOrigin || site === "same-origin")) {
        throw new HTTPException(403, { message: "cross-site request refused" });
      }
    }
    c.set("user", user);
    c.set("viaCookie", viaCookie);
    await next();
  });

  app.post("/auth/logout", async (c) => {
    const auth = c.req.header("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : getCookie(c, SESSION_COOKIE);
    if (token) await endSession(ctx, token);
    deleteCookie(c, SESSION_COOKIE, { path: "/api" });
    return c.body(null, 204);
  });

  app.get("/me", async (c) => {
    const user = c.get("user");
    const memberships = await ctx.db
      .select({ id: households.id, name: households.name, role: householdMembers.role })
      .from(householdMembers)
      .innerJoin(households, eq(households.id, householdMembers.householdId))
      .where(eq(householdMembers.userId, user.id))
      .orderBy(households.createdAt);
    return c.json({ user: userJson(user), households: memberships, mailEnabled: ctx.mail.canSend });
  });

  app.patch("/me", async (c) => {
    const input = await body(c, z.object({ locale: v.locale }));
    await ctx.db.update(users).set({ locale: input.locale }).where(eq(users.id, c.get("user").id));
    return c.body(null, 204);
  });

  // --- Households -------------------------------------------------------------

  async function requireMember(c: Context<Env>, householdId: string) {
    const [m] = await ctx.db
      .select()
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, c.get("user").id)));
    if (!m) throw new HTTPException(404, { message: "not found" });
    return m;
  }

  app.patch("/households/:hid", async (c) => {
    const hid = param(c, "hid");
    await requireMember(c, hid);
    const input = await body(c, z.object({ name: z.string().trim().min(1).max(60) }));
    await ctx.db.update(households).set({ name: input.name }).where(eq(households.id, hid));
    return c.body(null, 204);
  });

  app.get("/households/:hid/members", async (c) => {
    const hid = param(c, "hid");
    await requireMember(c, hid);
    const rows = await ctx.db
      .select({ id: users.id, email: users.email, role: householdMembers.role })
      .from(householdMembers)
      .innerJoin(users, eq(users.id, householdMembers.userId))
      .where(eq(householdMembers.householdId, hid))
      .orderBy(householdMembers.createdAt);
    const invites = await ctx.db
      .select({ id: householdInvites.id, email: householdInvites.email, expiresAt: householdInvites.expiresAt })
      .from(householdInvites)
      .where(
        and(
          eq(householdInvites.householdId, hid),
          isNull(householdInvites.acceptedAt),
          gt(householdInvites.expiresAt, ctx.now()),
        ),
      );
    return c.json({ members: rows, invites });
  });

  app.post("/households/:hid/invites", async (c) => {
    const hid = param(c, "hid");
    await requireMember(c, hid);
    const input = await body(c, z.object({ email: v.email, locale: v.locale.optional() }));
    if (!inviteUserLimit.take(c.get("user").id) || !inviteRecipientLimit.take(input.email)) {
      throw new HTTPException(429, { message: "too many invitations; try again tomorrow" });
    }
    const token = randomToken("pp_i_");
    const expiresAt = new Date(ctx.now().getTime() + INVITE_DAYS * 86_400_000);
    const [invite] = await ctx.db
      .insert(householdInvites)
      .values({ householdId: hid, email: input.email, tokenHash: sha256(token), invitedBy: c.get("user").id, expiresAt })
      .returning();
    const url = `${ctx.cfg.PUBLIC_URL}/invite#token=${encodeURIComponent(token)}`;
    const locale = input.locale ?? toLocale(c.get("user").locale);
    if (ctx.mail.canSend) {
      await ctx.mail.send(inviteMail(input.email, locale, ctx.cfg.PUBLIC_URL, url, "parent", INVITE_DAYS));
    }
    // Without mail the inviter can pass the link on by hand.
    return c.json(
      {
        id: invite!.id,
        email: invite!.email,
        expiresAt: expiresAt.toISOString(),
        mailed: ctx.mail.canSend,
        ...(ctx.mail.canSend ? {} : { url }),
      },
      201,
    );
  });

  app.delete("/households/:hid/invites/:iid", async (c) => {
    const hid = param(c, "hid");
    await requireMember(c, hid);
    await ctx.db
      .delete(householdInvites)
      .where(and(eq(householdInvites.id, param(c, "iid")), eq(householdInvites.householdId, hid)));
    return c.body(null, 204);
  });

  app.post("/invites/accept", async (c) => {
    const input = await body(c, z.object({ token: z.string().min(10).max(200) }));
    const user = c.get("user");
    const hid = await ctx.db.transaction(async (tx) => {
      const [invite] = await tx
        .update(householdInvites)
        .set({ acceptedAt: ctx.now() })
        .where(
          and(
            eq(householdInvites.tokenHash, sha256(input.token)),
            isNull(householdInvites.acceptedAt),
            gt(householdInvites.expiresAt, ctx.now()),
          ),
        )
        .returning();
      if (!invite) return null;
      await tx
        .insert(householdMembers)
        .values({ householdId: invite.householdId, userId: user.id, role: "parent" })
        .onConflictDoNothing();
      return invite.householdId;
    });
    if (!hid) return c.json({ error: "this invitation is expired or already used" }, 400);
    return c.json({ householdId: hid });
  });

  app.delete("/households/:hid/members/:uid", async (c) => {
    const hid = param(c, "hid");
    const me = await requireMember(c, hid);
    const uid = param(c, "uid");
    if (me.role !== "owner" && uid !== c.get("user").id) {
      throw new HTTPException(403, { message: "only the owner can remove other members" });
    }
    const [{ n } = { n: 0 }] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, hid));
    if (n <= 1) throw new HTTPException(409, { message: "a household needs at least one member" });
    await ctx.db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(householdMembers)
        .where(and(eq(householdMembers.householdId, hid), eq(householdMembers.userId, uid)))
        .returning();
      if (removed?.role !== "owner") return;
      // The household always keeps an owner: the longest-standing parent takes over.
      const [next] = await tx
        .select()
        .from(householdMembers)
        .where(eq(householdMembers.householdId, hid))
        .orderBy(householdMembers.createdAt)
        .limit(1);
      if (next) {
        await tx
          .update(householdMembers)
          .set({ role: "owner" })
          .where(and(eq(householdMembers.householdId, hid), eq(householdMembers.userId, next.userId)));
      }
    });
    return c.body(null, 204);
  });

  // --- Phones -----------------------------------------------------------------

  async function myHouseholdIds(userId: string) {
    const rows = await ctx.db
      .select({ id: householdMembers.householdId })
      .from(householdMembers)
      .where(eq(householdMembers.userId, userId));
    return rows.map((r) => r.id);
  }

  async function requirePhone(c: Context<Env>): Promise<Phone> {
    const pid = param(c, "pid");
    const [row] = await ctx.db
      .select({ phone: phones })
      .from(phones)
      .innerJoin(
        householdMembers,
        and(eq(householdMembers.householdId, phones.householdId), eq(householdMembers.userId, c.get("user").id)),
      )
      .where(eq(phones.id, pid));
    if (!row) throw new HTTPException(404, { message: "not found" });
    return row.phone;
  }

  async function change(c: Context<Env>, phone: Phone, op: Op) {
    try {
      const r = await submitChange(ctx, phone, c.get("user").id, op);
      return c.json(changeJson(r), r.status === "applied" ? 200 : 202);
    } catch (err) {
      if (err instanceof ChangeError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  }

  app.get("/phones", async (c) => {
    const hids = await myHouseholdIds(c.get("user").id);
    if (hids.length === 0) return c.json({ phones: [] });
    const rows = await ctx.db.select().from(phones).where(inArray(phones.householdId, hids)).orderBy(phones.createdAt);
    return c.json({ phones: await Promise.all(rows.map((p) => phoneSummary(ctx, p))) });
  });

  app.post("/phones/claim", async (c) => {
    if (!claimLimit.take(`${clientIp(c, ctx.cfg.TRUST_PROXY)}:${c.get("user").id}`)) {
      throw new HTTPException(429, { message: "too many attempts; wait a few minutes" });
    }
    const input = await body(
      c,
      z.object({
        code: z.string().max(20).transform(normalizePairingCode),
        name: z.string().trim().min(1).max(40),
        profile: z.enum(["child", "self"]),
        householdId: z.uuid().optional(),
        timezone: z.string().max(64).optional(),
      }),
    );
    const hids = await myHouseholdIds(c.get("user").id);
    const householdId = input.householdId ?? hids[0];
    if (!householdId || !hids.includes(householdId)) throw new HTTPException(404, { message: "household not found" });
    if (input.timezone && !Intl.supportedValuesOf("timeZone").includes(input.timezone)) {
      return c.json({ error: "unknown time zone" }, 400);
    }

    const deviceToken = randomToken(DEVICE_PREFIX);
    // One transaction: a phone polling meanwhile sees either "waiting" or its token.
    const phone = await ctx.db.transaction(async (tx) => {
      const [p] = await tx
        .select()
        .from(pairings)
        .where(
          and(eq(pairings.codeHash, sha256(input.code)), isNull(pairings.claimedAt), gt(pairings.expiresAt, ctx.now())),
        )
        .for("update");
      if (!p) return null;
      const created = await createPhone(ctx, tx, {
        householdId,
        name: input.name,
        profile: input.profile,
        mode: p.mode,
        deviceTokenHash: sha256(deviceToken),
        deviceInfo: p.deviceInfo ?? null,
        timezone: input.timezone,
      });
      await tx
        .update(pairings)
        .set({ claimedAt: ctx.now(), phoneId: created.id, pendingDeviceToken: deviceToken })
        .where(eq(pairings.id, p.id));
      return created;
    });
    if (!phone) return c.json({ error: "code not found or expired; check the code on the phone" }, 404);
    await syncDns(ctx, phone.id);
    return c.json(await phoneSummary(ctx, phone), 201);
  });

  app.get("/phones/:pid", async (c) => c.json(await phoneSummary(ctx, await requirePhone(c))));

  app.patch("/phones/:pid", async (c) => {
    const phone = await requirePhone(c);
    const input = await body(
      c,
      z.object({ name: z.string().trim().min(1).max(40).optional(), locationEnabled: z.boolean().optional() }),
    );
    await ctx.db
      .update(phones)
      .set({
        ...(input.name ? { name: input.name } : {}),
        ...(input.locationEnabled !== undefined
          ? { locationEnabled: input.locationEnabled, ...(input.locationEnabled ? {} : { locateRequestedAt: null }) }
          : {}),
      })
      .where(eq(phones.id, phone.id));
    // Turning location off deletes the stored position (D7: keep as little as possible).
    if (input.locationEnabled === false) await ctx.db.delete(locations).where(eq(locations.phoneId, phone.id));
    if (input.locationEnabled !== undefined) await wakePhone(ctx, phone.id, "rules");
    const [updated] = await ctx.db.select().from(phones).where(eq(phones.id, phone.id));
    return c.json(await phoneSummary(ctx, updated!));
  });

  // On a Self phone this goes through the key: otherwise the owner could remove the
  // phone and pair it again as a Child phone, which has no key.
  app.delete("/phones/:pid", async (c) => {
    const phone = await requirePhone(c);
    return change(c, phone, { type: "phone.remove", dnsClientId: phone.dnsClientId });
  });

  // Apps
  app.get("/phones/:pid/apps", async (c) => {
    const phone = await requirePhone(c);
    const rows = await ctx.db
      .select()
      .from(phoneApps)
      .where(and(eq(phoneApps.phoneId, phone.id), eq(phoneApps.installed, true)))
      .orderBy(phoneApps.label);
    return c.json({
      apps: rows.map((a) => ({ packageName: a.packageName, label: a.label, allowed: a.allowed, core: a.core })),
    });
  });

  app.put("/phones/:pid/apps/:package", async (c) => {
    const phone = await requirePhone(c);
    const pkg = v.packageName.safeParse(c.req.param("package"));
    if (!pkg.success) throw new HTTPException(404, { message: "not found" });
    const input = await body(c, z.object({ allowed: z.boolean() }));
    return change(c, phone, { type: "app.set", packageName: pkg.data, allowed: input.allowed });
  });

  // Contacts
  app.get("/phones/:pid/contacts", async (c) => {
    const phone = await requirePhone(c);
    const rows = await ctx.db.select().from(contacts).where(eq(contacts.phoneId, phone.id)).orderBy(contacts.name);
    return c.json({ contacts: rows.map((r) => ({ id: r.id, name: r.name, number: r.number })) });
  });

  app.post("/phones/:pid/contacts", async (c) => {
    const phone = await requirePhone(c);
    const input = await body(c, z.object({ name: z.string().trim().min(1).max(60), number: v.phoneNumber }));
    return change(c, phone, { type: "contact.add", ...input });
  });

  app.delete("/phones/:pid/contacts/:cid", async (c) => {
    const phone = await requirePhone(c);
    return change(c, phone, { type: "contact.remove", contactId: param(c, "cid") });
  });

  // Web filter
  app.get("/phones/:pid/dns", async (c) => {
    const phone = await requirePhone(c);
    const [row] = await ctx.db.select().from(dnsSettings).where(eq(dnsSettings.phoneId, phone.id));
    return c.json({
      host: `${phone.dnsClientId}.${ctx.cfg.DNS_HOST_SUFFIX}`,
      synced: !phone.dnsDirty,
      blockedCategories: row?.blockedCategories ?? [],
      allowDomains: row?.allowDomains ?? [],
      blockDomains: row?.blockDomains ?? [],
    });
  });

  app.put("/phones/:pid/dns/categories/:category", async (c) => {
    const phone = await requirePhone(c);
    const category = v.dnsCategory.safeParse(c.req.param("category"));
    if (!category.success) throw new HTTPException(404, { message: "unknown category" });
    const input = await body(c, z.object({ blocked: z.boolean() }));
    return change(c, phone, { type: "dns.category", category: category.data, blocked: input.blocked });
  });

  for (const [path, type] of [
    ["allow", "dns.allowDomain"],
    ["block", "dns.blockDomain"],
  ] as const) {
    app.post(`/phones/:pid/dns/${path}`, async (c) => {
      const phone = await requirePhone(c);
      const input = await body(c, z.object({ domain: v.domain }));
      return change(c, phone, { type, domain: input.domain, present: true });
    });
    app.delete(`/phones/:pid/dns/${path}/:domain`, async (c) => {
      const phone = await requirePhone(c);
      const d = v.domain.safeParse(c.req.param("domain"));
      if (!d.success) throw new HTTPException(404, { message: "not found" });
      return change(c, phone, { type, domain: d.data, present: false });
    });
  }

  // School time and bedtime
  app.get("/phones/:pid/schedules", async (c) => {
    const phone = await requirePhone(c);
    const rows = await ctx.db
      .select()
      .from(schedules)
      .where(eq(schedules.phoneId, phone.id))
      .orderBy(schedules.createdAt);
    return c.json({
      schedules: rows.map((s) => ({
        id: s.id,
        kind: s.kind,
        days: s.days,
        startMinute: s.startMinute,
        endMinute: s.endMinute,
        allowedPackages: s.allowedPackages,
      })),
    });
  });

  app.post("/phones/:pid/schedules", async (c) => {
    const phone = await requirePhone(c);
    const schedule = await body(c, v.scheduleInput);
    return change(c, phone, { type: "schedule.create", schedule });
  });

  app.put("/phones/:pid/schedules/:sid", async (c) => {
    const phone = await requirePhone(c);
    const schedule = await body(c, v.scheduleInput);
    return change(c, phone, { type: "schedule.update", scheduleId: param(c, "sid"), schedule });
  });

  app.delete("/phones/:pid/schedules/:sid", async (c) => {
    const phone = await requirePhone(c);
    return change(c, phone, { type: "schedule.delete", scheduleId: param(c, "sid") });
  });

  // Location (D7: only the latest position)
  app.get("/phones/:pid/location", async (c) => {
    const phone = await requirePhone(c);
    const [loc] = await ctx.db.select().from(locations).where(eq(locations.phoneId, phone.id));
    return c.json({
      enabled: phone.locationEnabled,
      requestedAt: phone.locateRequestedAt?.toISOString() ?? null,
      location: loc
        ? { lat: loc.lat, lon: loc.lon, accuracyM: loc.accuracyM, recordedAt: loc.recordedAt.toISOString() }
        : null,
    });
  });

  app.post("/phones/:pid/locate", async (c) => {
    const phone = await requirePhone(c);
    if (!phone.locationEnabled) return c.json({ error: "location is off for this phone" }, 409);
    await ctx.db.update(phones).set({ locateRequestedAt: ctx.now() }).where(eq(phones.id, phone.id));
    await wakePhone(ctx, phone.id, "locate");
    return c.json({ requestedAt: ctx.now().toISOString() }, 202);
  });

  // Self key (D12, D13)
  app.get("/phones/:pid/key", async (c) => {
    const phone = await requirePhone(c);
    if (phone.profile !== "self") return c.json({ error: "only Self phones have a key" }, 404);
    const [k] = await ctx.db.select().from(selfKeys).where(eq(selfKeys.phoneId, phone.id));
    return c.json(keyJson(k!));
  });

  app.put("/phones/:pid/key", async (c) => {
    const phone = await requirePhone(c);
    if (phone.profile !== "self") return c.json({ error: "only Self phones have a key" }, 404);
    const key = await body(c, v.keyInput);
    if (key.trustedEmail && key.trustedEmail === c.get("user").email) {
      return c.json({ error: "the trusted person must be someone else" }, 400);
    }
    return change(c, phone, { type: "key.set", key });
  });

  // Pending changes
  app.get("/phones/:pid/changes", async (c) => {
    const phone = await requirePhone(c);
    const [k] = await ctx.db.select().from(selfKeys).where(eq(selfKeys.phoneId, phone.id));
    const rows = await listPending(ctx, [phone.id]);
    return c.json({ changes: rows.map((r) => pendingJson(r, phone, k)) });
  });

  app.post("/changes/:cid/cancel", async (c) => {
    const cid = param(c, "cid");
    const [row] = await ctx.db
      .select({ change: pendingChanges })
      .from(pendingChanges)
      .innerJoin(phones, eq(phones.id, pendingChanges.phoneId))
      .innerJoin(
        householdMembers,
        and(eq(householdMembers.householdId, phones.householdId), eq(householdMembers.userId, c.get("user").id)),
      )
      .where(eq(pendingChanges.id, cid));
    if (!row) throw new HTTPException(404, { message: "not found" });
    const [updated] = await ctx.db
      .update(pendingChanges)
      .set({ status: "cancelled", decidedBy: c.get("user").id, decidedAt: ctx.now() })
      .where(and(eq(pendingChanges.id, cid), eq(pendingChanges.status, "pending")))
      .returning();
    if (!updated) return c.json({ error: "this change is no longer pending" }, 409);
    await wakePhone(ctx, row.change.phoneId, "rules");
    return c.body(null, 204);
  });

  // Requests for a trusted person
  async function requireTrusted(c: Context<Env>) {
    const cid = param(c, "cid");
    const [row] = await ctx.db
      .select({ change: pendingChanges })
      .from(pendingChanges)
      .innerJoin(selfKeys, eq(selfKeys.phoneId, pendingChanges.phoneId))
      .where(
        and(
          eq(pendingChanges.id, cid),
          eq(pendingChanges.keyType, "trusted"),
          eq(selfKeys.trustedUserId, c.get("user").id),
        ),
      );
    if (!row) throw new HTTPException(404, { message: "not found" });
    return row.change;
  }

  app.get("/approvals", async (c) => {
    const rows = await ctx.db
      .select({ change: pendingChanges, phoneName: phones.name, requester: users.email, appLabel: phoneApps.label })
      .from(pendingChanges)
      .innerJoin(selfKeys, eq(selfKeys.phoneId, pendingChanges.phoneId))
      .innerJoin(phones, eq(phones.id, pendingChanges.phoneId))
      .leftJoin(users, eq(users.id, pendingChanges.requestedBy))
      // The trusted person cannot see the phone's app list, so name the app here.
      .leftJoin(
        phoneApps,
        and(
          eq(phoneApps.phoneId, pendingChanges.phoneId),
          eq(phoneApps.packageName, sql`${pendingChanges.op}->>'packageName'`),
        ),
      )
      .where(
        and(
          eq(selfKeys.trustedUserId, c.get("user").id),
          eq(pendingChanges.keyType, "trusted"),
          eq(pendingChanges.status, "pending"),
        ),
      )
      .orderBy(desc(pendingChanges.createdAt));
    return c.json({
      approvals: rows.map((r) => ({
        id: r.change.id,
        phoneName: r.phoneName,
        requestedBy: r.requester,
        op: r.change.op,
        appLabel: r.appLabel,
        createdAt: r.change.createdAt.toISOString(),
      })),
    });
  });

  app.post("/changes/:cid/approve", async (c) => {
    const change = await requireTrusted(c);
    const r = await applyPending(ctx, change.id, c.get("user").id);
    if (r === "gone") return c.json({ error: "this change is no longer pending" }, 409);
    return c.body(null, 204);
  });

  app.post("/changes/:cid/reject", async (c) => {
    const change = await requireTrusted(c);
    const [updated] = await ctx.db
      .update(pendingChanges)
      .set({ status: "rejected", decidedBy: c.get("user").id, decidedAt: ctx.now() })
      .where(and(eq(pendingChanges.id, change.id), eq(pendingChanges.status, "pending")))
      .returning();
    if (!updated) return c.json({ error: "this change is no longer pending" }, 409);
    await wakePhone(ctx, change.phoneId, "rules");
    return c.body(null, 204);
  });

  // Pay to unlock (D13): data model and flag only. No payment provider yet.
  app.post("/changes/:cid/pay-unlock", async (c) => {
    const cid = param(c, "cid");
    const [row] = await ctx.db
      .select({ change: pendingChanges, phone: phones, key: selfKeys })
      .from(pendingChanges)
      .innerJoin(phones, eq(phones.id, pendingChanges.phoneId))
      .innerJoin(selfKeys, eq(selfKeys.phoneId, phones.id))
      .innerJoin(
        householdMembers,
        and(eq(householdMembers.householdId, phones.householdId), eq(householdMembers.userId, c.get("user").id)),
      )
      .where(and(eq(pendingChanges.id, cid), eq(pendingChanges.status, "pending")));
    if (!row) throw new HTTPException(404, { message: "not found" });
    if (!payUnlockOffered(row.change, row.phone, row.key)) {
      return c.json({ error: "pay to unlock is not available for this change" }, 409);
    }
    return c.json({ error: "payments are not available yet" }, 501);
  });

  function payUnlockOffered(
    change: typeof pendingChanges.$inferSelect,
    phone: Phone,
    key: typeof selfKeys.$inferSelect | undefined,
  ) {
    return (
      ctx.cfg.PAYMENTS_ENABLED &&
      phone.profile === "self" &&
      change.keyType === "delay" &&
      Boolean(key?.payUnlockEnabled)
    );
  }

  function pendingJson(
    r: typeof pendingChanges.$inferSelect,
    phone: Phone,
    key: typeof selfKeys.$inferSelect | undefined,
  ) {
    return {
      id: r.id,
      op: r.op,
      keyType: r.keyType,
      effectiveAt: r.effectiveAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      payUnlock: payUnlockOffered(r, phone, key)
        ? { amount: key!.payUnlockAmount, currency: key!.payUnlockCurrency, recipient: key!.payUnlockRecipient }
        : null,
    };
  }

  return app;
}

function userJson(u: User) {
  return { id: u.id, email: u.email, locale: u.locale };
}

function keyJson(k: typeof selfKeys.$inferSelect) {
  return {
    keyType: k.keyType,
    delayHours: k.delayHours,
    trustedEmail: k.trustedEmail,
    trustedAccepted: Boolean(k.trustedUserId),
    payUnlockEnabled: k.payUnlockEnabled,
    payUnlockAmount: k.payUnlockAmount,
    payUnlockCurrency: k.payUnlockCurrency,
    payUnlockRecipient: k.payUnlockRecipient,
  };
}
