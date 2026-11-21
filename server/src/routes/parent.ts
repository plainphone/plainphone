// SPDX-License-Identifier: Apache-2.0
//
// The API the parent app (PWA, later native apps) talks to. Contract: server/openapi.yaml.

import { and, desc, eq, gt, inArray, isNull, notExists, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  contacts,
  dnsSettings,
  frpAccounts,
  householdInvites,
  householdMembers,
  households,
  locations,
  notificationMutes,
  pairings,
  FILTER_METHODS,
  pendingChanges,
  phoneApps,
  phones,
  pushSubscriptions,
  schedules,
  selfKeys,
  users,
} from "../db/schema.js";
import { DEFAULT_PUSH_HOSTS, parentPushEnabled, pushHostAllowed } from "../providers/parent-push.js";
import { registerNativeSubscription, removePushSubscription } from "../services/push-subscriptions.js";
import { notifyUsers } from "../services/notifications.js";
import { emergencyInput, emergencyState, listOpenings } from "../services/emergency-openings.js";
import { selfLevel } from "../lib/self-level.js";
import { explainDecision } from "../services/approval-outcome.js";
import { approveRequest, openRequests, recentAnswers, rejectRequest, RequestError } from "../services/requests.js";
import { normalizePairingCode, randomToken, sha256 } from "../lib/crypto.js";
import { body, clientIp, param, RateLimiter } from "../lib/http.js";
import { inviteMail } from "../lib/mail-templates.js";
import { toLocale } from "../lib/locale.js";
import { homeInput, homePromiseInput, isSettingKey, settingBody } from "../lib/phone-settings.js";
import { approvalAppLabel, approvalBonusDate, approvalRevision, formatApprovalSummary, loadApprovalSummaries } from "../services/approval-summary.js";
import { DEFAULT_SETUP_UNDO_MINUTES, setupUndoDeadline, undoMinutesInput } from "../lib/setup-undo.js";
import { acceptTrustedInvite, issueTrustedInvite, TRUSTED_INVITE_PREFIX } from "../services/trusted-invites.js";
import { applySelfTemplate, readSelfTemplate, shareSelfTemplate, templateCode } from "../services/self-template.js";
import * as v from "../lib/validation.js";
import { categoryOf, isAppCategory, OPEN_CATEGORIES } from "../lib/open-mode.js";
import { deleteAccount } from "../services/account.js";
import { endSession, requestMagicLink, SESSION_DAYS, resolveSession, verifyMagicLink } from "../services/auth.js";
import {
  applyPending,
  rejectTrustedChange,
  ChangeError,
  type ChangeResult,
  listPending,
  type Op,
  submitChange,
} from "../services/changes.js";
import { childContactSettingsInput, pendingContactSuggestions, reviewContactSuggestions, reviewContactSuggestionsInput, updateChildContactSettings } from "../services/contact-suggestions.js";
import type { Ctx } from "../services/context.js";
import type { UpdateWake } from "../services/update-wake.js";
import { isDnsReady, isRulesDnsReady, syncDns } from "../services/dns.js";
import { invalidateEnrollments, issueEnrollment } from "../services/enrollment.js";
import { parentIosSelectionRoutes } from "./ios-selection.js";
import { IOS_PAIRING_NOT_YET } from "../lib/ios.js";
import { createPhone, loadPhoneSettings, nextRulesRevision, phoneSummaries, phoneSummary, wakePhone } from "../services/phones.js";
import { mountServerMoveRoutes } from "./server-move.js";
import { phoneCatalogRoutes } from "./catalog.js";
import { DEVICE_PREFIX } from "./device.js";
import { limitRoutes } from "./limits.js";
import { modeRoutes } from "./modes.js";
import { ModeError, setModesEnabled } from "../services/modes.js";
import { summaryRoutes } from "./summary.js";
import { parentMoreTimeRoutes } from "./more-time.js";
import { locationRoutes, setLocationMode } from "./location.js";
import { parentSosRoutes } from "./sos.js";
import { parentAgeRoutes } from "./age-agreement.js";

type User = typeof users.$inferSelect;
type Phone = typeof phones.$inferSelect;
export type ParentEnv = { Variables: { user: User; sessionId: string; viaCookie: boolean } };

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

export function parentRoutes(ctx: Ctx, updateWake: UpdateWake, extra?: (app: Hono<ParentEnv>) => void) {
  const app = new Hono<ParentEnv>();
  const secureCookie = ctx.cfg.PUBLIC_URL.startsWith("https://");
  const publicOrigin = new URL(ctx.cfg.PUBLIC_URL).origin;
  const loginIpLimit = new RateLimiter(20, 60 * 60_000);
  const loginEmailLimit = new RateLimiter(5, 60 * 60_000);
  const verifyLimit = new RateLimiter(30, 15 * 60_000);
  const claimLimit = new RateLimiter(20, 15 * 60_000);
  const selfTemplateLimit = new RateLimiter(20, 60 * 60_000);
  const enrollLimit = new RateLimiter(30, 24 * 60 * 60_000);
  // "Update now" wakes the child's phone: a script must not wake it every second.
  const wakeLimit = new RateLimiter(30, 60 * 60_000);
  const inviteUserLimit = new RateLimiter(20, 24 * 60 * 60_000);
  const inviteRecipientLimit = new RateLimiter(3, 24 * 60 * 60_000);

  // --- Auth -------------------------------------------------------------------

  app.post("/auth/request", async (c) => {
    const ipAllowed = loginIpLimit.take(clientIp(c, ctx.cfg.TRUST_PROXY));
    const input = await body(
      c,
      z.object({
        email: v.email,
        locale: v.locale.default("en"),
        /** Native apps get a link the app opens (/auth/app) instead of the PWA's. */
        client: z.enum(["web", "native"]).default("web"),
      }),
    );
    if (!ipAllowed || !loginEmailLimit.take(input.email)) {
      throw new HTTPException(429, { message: "too many login links; try again later" });
    }
    await requestMagicLink(ctx, input.email, toLocale(input.locale), input.client);
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
    const session = token ? await resolveSession(ctx, token) : null;
    if (!session) throw new HTTPException(401, { message: "sign in first" });
    const viaCookie = !bearer;
    // CSRF: a cookie-authenticated write must come from our own origin.
    if (viaCookie && !["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      const site = c.req.header("sec-fetch-site");
      if (!(origin === publicOrigin || site === "same-origin")) {
        throw new HTTPException(403, { message: "cross-site request refused" });
      }
    }
    c.set("user", session.user);
    c.set("sessionId", session.id);
    c.set("viaCookie", viaCookie);
    await next();
  });

  // Routes that live in their own files but need the session check above.
  extra?.(app);

  app.post("/auth/logout", async (c) => {
    await endSession(ctx, c.get("sessionId"));
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
    return c.json({ user: userJson(user), households: memberships, mailEnabled: ctx.mail.canSend, iosPairing: ctx.cfg.IOS_PAIRING_ENABLED });
  });

  app.patch("/me", async (c) => {
    const input = await body(c, z.object({ locale: v.locale }));
    await ctx.db.update(users).set({ locale: input.locale }).where(eq(users.id, c.get("user").id));
    return c.body(null, 204);
  });

  // Deletes the account (#11). The body repeats the address, so a stray request cannot do it.
  app.delete("/me", async (c) => {
    const user = c.get("user");
    const input = await body(c, z.object({ confirmEmail: z.string().trim().toLowerCase() }));
    if (input.confirmEmail !== user.email) {
      return c.json({ error: "type your own email address to confirm" }, 400);
    }
    const r = await deleteAccount(ctx, user.id);
    if (r.status === "blocked") {
      return c.json(
        {
          error: "remove your Self phones first; removing them goes through their key",
          selfPhoneIds: r.selfPhoneIds,
        },
        409,
      );
    }
    deleteCookie(c, SESSION_COOKIE, { path: "/api" });
    return c.json({ householdsDeleted: r.householdsDeleted, phonesRemoved: r.phonesRemoved });
  });

  // --- Notifications (Web Push, APNs and FCM) ---

  const pushHosts = [
    ...DEFAULT_PUSH_HOSTS,
    ...ctx.cfg.PUSH_EXTRA_HOSTS.split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  ];
  const pushTestLimit = new RateLimiter(10, 60 * 60_000);
  const subscriptionJson = (s: typeof pushSubscriptions.$inferSelect) => ({
    id: s.id,
    platform: s.platform,
    label: s.label,
    // Lets a browser recognise its own row without the endpoint (a capability) leaving the server.
    endpointHash: createHash("sha256").update(s.endpoint).digest("hex"),
    createdAt: s.createdAt.toISOString(),
    lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
  });

  app.get("/notifications", async (c) => {
    const user = c.get("user");
    const subs = await ctx.db
      .select()
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.state, "active")))
      .orderBy(pushSubscriptions.createdAt);
    const muted = await ctx.db
      .select({ phoneId: notificationMutes.phoneId })
      .from(notificationMutes)
      .where(eq(notificationMutes.userId, user.id));
    return c.json({
      webPushEnabled: Boolean(ctx.parentPush.webPublicKey),
      webPushPublicKey: ctx.parentPush.webPublicKey,
      offlineAlertHours: ctx.cfg.OFFLINE_ALERT_HOURS,
      subscriptions: subs.map(subscriptionJson),
      mutedPhoneIds: muted.map((m) => m.phoneId),
    });
  });

  app.post("/notifications/subscriptions", async (c) => {
    const user = c.get("user");
    const label = z.string().trim().max(60).optional();
    const input = await body(
      c,
      z.discriminatedUnion("platform", [
        z.object({
          platform: z.literal("web"),
          endpoint: z.string().max(2000),
          keys: z.object({ p256dh: z.string().min(80).max(100), auth: z.string().min(16).max(40) }),
          label,
          // The browser rotated the subscription: the old endpoint this one replaces.
          replaces: z.string().max(2000).optional(),
        }),
        z.object({
          platform: z.enum(["apns", "fcm"]),
          token: z.string().regex(/^[A-Za-z0-9_:.-]{16,1024}$/),
          replaces: z.string().max(1024).optional(),
          subscriptionId: z.uuid().optional(),
          installationKey: z.string().regex(/^[A-Za-z0-9_:.-]{16,1024}$/).optional(),
          optIn: z.boolean().optional(),
          label,
        }),
      ]),
    );
    if (!parentPushEnabled(ctx.parentPush, input.platform)) {
      return c.json({ error: "notifications are not set up on this server" }, 409);
    }
    if (input.platform === "web" && !pushHostAllowed(input.endpoint, pushHosts)) {
      return c.json({ error: "unknown push service" }, 400);
    }
    if (input.platform !== "web") {
      const result = await registerNativeSubscription(ctx, user.id, c.get("sessionId"), input);
      if (result.status !== 201) return c.json({ error: result.error }, result.status);
      return c.json(subscriptionJson(result.row), 201);
    }

    const values = { endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth };
    const [row] = await ctx.db
      .insert(pushSubscriptions)
      .values({ userId: user.id, platform: input.platform, label: input.label ?? null, ...values })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        setWhere: eq(pushSubscriptions.platform, "web"),
        set: {
          userId: user.id,
          platform: input.platform,
          label: sql`coalesce(excluded.label, ${pushSubscriptions.label})`,
          failures: 0,
          ...values,
        },
      })
      .returning();
    if (!row) return c.json({ error: "endpoint already registered" }, 409);
    if (input.replaces && input.replaces !== values.endpoint) {
      const [old] = await ctx.db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, input.replaces), eq(pushSubscriptions.platform, input.platform)))
        .returning({ label: pushSubscriptions.label });
      // The service worker cannot tell the device's name; keep the one the old row had.
      if (old?.label && !row.label) {
        row.label = old.label;
        await ctx.db.update(pushSubscriptions).set({ label: old.label }).where(eq(pushSubscriptions.id, row.id));
      }
    }
    return c.json(subscriptionJson(row), 201);
  });

  app.delete("/notifications/subscriptions/:sid", async (c) => {
    await removePushSubscription(ctx, c.get("user").id, param(c, "sid"));
    return c.body(null, 204);
  });

  app.post("/notifications/test", async (c) => {
    const user = c.get("user");
    const input = await body(c, z.object({ subscriptionId: z.uuid().optional() }));
    if (!pushTestLimit.take(user.id)) throw new HTTPException(429, { message: "too many test notifications" });
    const sent = await notifyUsers(ctx, [user.id], { type: "test" }, { subscriptionId: input.subscriptionId });
    return c.json({ sent });
  });

  // --- Households -------------------------------------------------------------

  async function requireMember(c: Context<ParentEnv>, householdId: string) {
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
          isNull(householdInvites.trustedPhoneId),
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
    if (!inviteUserLimit.take(c.get("user").id) || !inviteRecipientLimit.take(`${hid}:${input.email}`)) {
      throw new HTTPException(429, { message: "too many invitations; try again tomorrow" });
    }
    const token = randomToken("pp_i_");
    const expiresAt = new Date(ctx.now().getTime() + INVITE_DAYS * 86_400_000);
    const [invite] = await ctx.db
      .insert(householdInvites)
      .values({ householdId: hid, email: input.email, tokenHash: sha256(token), invitedBy: c.get("user").id, expiresAt })
      .returning();
    const url = `${ctx.cfg.PUBLIC_URL}/invite#token=${encodeURIComponent(token)}`;
    const locale = toLocale(input.locale ?? c.get("user").locale);
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
    if (input.token.startsWith(TRUSTED_INVITE_PREFIX)) {
      if (!(await acceptTrustedInvite(ctx, input.token, user))) {
        return c.json({ error: "this invitation is expired, already used, or is for someone else" }, 400);
      }
      return c.json({ trusted: true });
    }
    const hid = await ctx.db
      .transaction(async (tx) => {
        // Deleted on acceptance (#8): the invited address is not needed once they are a member.
        const [invite] = await tx
          .delete(householdInvites)
          .where(
            and(
              eq(householdInvites.tokenHash, sha256(input.token)),
              isNull(householdInvites.trustedPhoneId),
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
      })
      // The household was deleted (its last member deleted their account) while we waited.
      .catch((err: { code?: string; cause?: { code?: string } }) => {
        if (err.code === "23503" || err.cause?.code === "23503") return null;
        throw err;
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
    const ok = await ctx.db.transaction(async (tx) => {
      // Locked like in account deletion, so two members leaving at once cannot both see two members.
      await tx.select({ id: households.id }).from(households).where(eq(households.id, hid)).for("update");
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(householdMembers)
        .where(eq(householdMembers.householdId, hid));
      if (n <= 1) return false;
      const [removed] = await tx
        .delete(householdMembers)
        .where(and(eq(householdMembers.householdId, hid), eq(householdMembers.userId, uid)))
        .returning();
      // Their reset-protection Google account leaves with them; it must not come back if they are invited again.
      if (removed) await tx.delete(frpAccounts).where(and(eq(frpAccounts.householdId, hid), eq(frpAccounts.userId, uid)));
      if (removed?.role !== "owner") return true;
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
      return true;
    });
    if (!ok) throw new HTTPException(409, { message: "a household needs at least one member" });
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

  /** A parent in several households must say which one; guessing could put a child's phone in a stranger's household. */
  function chooseHousehold(hids: string[], asked: string | undefined) {
    if (asked) return asked;
    if (hids.length > 1) throw new HTTPException(400, { message: "householdId is required when you are in more than one household" });
    return hids[0];
  }

  async function requirePhone(c: Context<ParentEnv>): Promise<Phone> {
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

  async function change(c: Context<ParentEnv>, phone: Phone, op: Op) {
    try {
      const r = await submitChange(ctx, phone, c.get("user").id, op);
      return c.json(changeJson(r), r.status === "applied" ? 200 : 202);
    } catch (err) {
      if (err instanceof ChangeError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  }

  mountServerMoveRoutes(app, ctx, { requireMember, requirePhone, change });
  parentIosSelectionRoutes(app, ctx, requirePhone);

  app.get("/phones", async (c) => {
    const hids = await myHouseholdIds(c.get("user").id);
    if (hids.length === 0) return c.json({ phones: [] });
    return c.json({ phones: await phoneSummaries(ctx, hids) });
  });

  app.post("/phones/pairing-profile", async (c) => {
    if (!claimLimit.take(`${clientIp(c, ctx.cfg.TRUST_PROXY)}:${c.get("user").id}`)) {
      throw new HTTPException(429, { message: "too many attempts; wait a few minutes" });
    }
    const { code } = await body(c, z.object({ code: z.string().max(20).transform(normalizePairingCode) }));
    const [p] = await ctx.db.select({ profile: pairings.profileHint, mode: pairings.mode, platform: pairings.platform }).from(pairings)
      .where(and(eq(pairings.codeHash, sha256(code)), isNull(pairings.claimedAt), gt(pairings.expiresAt, ctx.now())));
    if (!p) return c.json({ error: "code not found" }, 404);
    return c.json(p);
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
        language: v.phoneLanguage.optional(),
        filterMethod: z.enum(FILTER_METHODS).optional(),
      }),
    );
    const hids = await myHouseholdIds(c.get("user").id);
    const householdId = chooseHousehold(hids, input.householdId);
    if (!householdId || !hids.includes(householdId)) throw new HTTPException(404, { message: "household not found" });
    if (input.timezone && input.timezone !== "UTC" && !Intl.supportedValuesOf("timeZone").includes(input.timezone)) {
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
      if (p.profileHint && input.profile !== p.profileHint) return "profileMismatch" as const;
      // The flag may have been switched off since the iPhone started pairing.
      if (p.platform === "ios" && !ctx.cfg.IOS_PAIRING_ENABLED) return "iosNotYet" as const;
      const created = await createPhone(ctx, tx, {
        householdId,
        name: input.name,
        profile: input.profile,
        mode: p.mode,
        platform: p.platform,
        filterMethod: input.filterMethod,
        deviceTokenHash: p.requiresConfirmation ? null : sha256(deviceToken),
        deviceInfo: p.deviceInfo ?? null,
        timezone: input.timezone,
        language: input.language,
      });
      await tx
        .update(pairings)
        .set({ claimedAt: ctx.now(), claimedBy: c.get("user").id, phoneId: created.id, pendingDeviceToken: deviceToken })
        .where(eq(pairings.id, p.id));
      return created;
    });
    if (!phone) return c.json({ error: "code not found or expired; check the code on the phone" }, 404);
    if (phone === "profileMismatch") return c.json({ error: "profile mismatch" }, 409);
    if (phone === "iosNotYet") return c.json(IOS_PAIRING_NOT_YET, 403);
    if (phone.deviceTokenHash) await syncDns(ctx, phone.id);
    return c.json(await phoneSummary(ctx, phone), 201);
  });

  // Strong-mode setup from the dashboard: a phone entry plus a one-time token for the provisioning
  // QR code, which the browser builds (it also hashes the maintenance PIN; the server never sees it).
  app.post("/phones/enroll", async (c) => {
    if (!enrollLimit.take(c.get("user").id)) throw new HTTPException(429, { message: "too many new phones today" });
    const input = await body(
      c,
      z.object({
        name: z.string().trim().min(1).max(40),
        profile: z.enum(["child", "self"]),
        mode: z.enum(["strong", "light"]).default("strong"),
        filterMethod: z.enum(FILTER_METHODS).optional(),
        template: templateCode.optional(),
        householdId: z.uuid().optional(),
        timezone: z.string().max(64).optional(),
        language: v.phoneLanguage.optional(),
      }),
    );
    const hids = await myHouseholdIds(c.get("user").id);
    const householdId = chooseHousehold(hids, input.householdId);
    if (!householdId || !hids.includes(householdId)) throw new HTTPException(404, { message: "household not found" });
    if (input.timezone && input.timezone !== "UTC" && !Intl.supportedValuesOf("timeZone").includes(input.timezone)) {
      return c.json({ error: "unknown time zone" }, 400);
    }
    if (input.template && input.profile !== "self") return c.json({ error: "only Self phones can copy rules" }, 400);
    const phone = await ctx.db.transaction(async (tx) => {
      const template = input.template ? await readSelfTemplate(tx, input.template, ctx.now()) : null;
      if (input.template && !template) return null;
      const created = await createPhone(ctx, tx, {
        householdId,
        name: input.name,
        profile: input.profile,
        mode: input.mode,
        filterMethod: input.filterMethod,
        deviceTokenHash: null,
        deviceInfo: null,
        timezone: input.timezone,
        language: input.language,
      });
      if (template) await applySelfTemplate(tx, created.id, template, ctx.now());
      return created;
    });
    if (!phone) return c.json({ error: "the setup template has expired" }, 404);
    const setup = await issueEnrollment(ctx, phone.id, c.get("user").id);
    if (!setup) return c.json({ error: "this phone is already set up" }, 409);
    // Register the DNS ClientID now, so the filter host is ready by the time the phone is set up.
    await syncDns(ctx, phone.id);
    return c.json({ phone: await phoneSummary(ctx, phone), ...setup }, 201);
  });

  // A new QR code for a phone that has not been set up yet (the old one expired or got lost).
  app.post("/phones/:pid/enrollment", async (c) => {
    const phone = await requirePhone(c);
    if (phone.pairedAt !== null) return c.json({ error: "this phone is already set up" }, 409);
    const [pending] = await ctx.db.select({ id: pairings.id }).from(pairings)
      .where(and(eq(pairings.phoneId, phone.id), eq(pairings.requiresConfirmation, true)));
    // Only a phone that has not confirmed the account has something left to confirm.
    if (phone.deviceTokenHash !== null) return c.json({ error: "this phone is already paired and will show here once it connects" }, 409);
    if (pending || phone.awaitingServerMove) return c.json({ error: "confirm the account on the phone" }, 409);
    if (!enrollLimit.take(c.get("user").id)) throw new HTTPException(429, { message: "too many setup codes today" });
    const setup = await issueEnrollment(ctx, phone.id, c.get("user").id);
    if (!setup) return c.json({ error: "this phone is already set up" }, 409);
    return c.json(setup, 201);
  });

  app.get("/phones/:pid", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await phoneSummary(ctx, await requirePhone(c)));
  });

  app.patch("/phones/:pid", async (c) => {
    const phone = await requirePhone(c);
    const input = await body(
      c,
      z.object({
        name: z.string().trim().min(1).max(40).optional(),
        locationEnabled: z.boolean().optional(),
        supportEnabled: z.boolean().optional(),
        releaseWarningsEnabled: z.boolean().optional(),
        askMoreTimeEnabled: z.boolean().optional(),
        limitWarningEnabled: z.boolean().optional(),
        pushWakeups: z.boolean().optional(),
        preferUnifiedPush: z.boolean().optional(),
        language: v.phoneLanguage.optional(),
        lockSystemLanguage: z.boolean().optional(),
        timezone: z.string().min(1).max(64).optional(),
        /** Hours of silence before the parents are told; null = server default, 0 = never. */
        offlineAlertHours: z.number().int().min(0).max(168).nullable().optional(),
        changeReceiptsEnabled: z.boolean().optional(),
        healthBoardEnabled: z.boolean().optional(),
        weeklySummaryEnabled: z.boolean().optional(),
        silentBedtime: z.boolean().optional(),
        pinApprovalEnabled: z.boolean().optional(),
        appUpdatesEnabled: z.boolean().optional(),
        modesEnabled: z.boolean().optional(),
      }),
    );
    const { changeReceiptsEnabled, healthBoardEnabled, weeklySummaryEnabled, silentBedtime, pinApprovalEnabled, appUpdatesEnabled } = input;
    const rulesField = changeReceiptsEnabled !== undefined || healthBoardEnabled !== undefined
      || weeklySummaryEnabled !== undefined || silentBedtime !== undefined || pinApprovalEnabled !== undefined
      || appUpdatesEnabled !== undefined;
    if (input.timezone !== undefined && input.timezone !== "UTC" && !Intl.supportedValuesOf("timeZone").includes(input.timezone)) {
      return c.json({ error: "unknown time zone" }, 400);
    }
    if (input.modesEnabled !== undefined) {
      // Child phones only; turning modes on the first time makes them (docs/modes.md).
      try {
        await setModesEnabled(ctx, phone, input.modesEnabled);
      } catch (e) {
        if (e instanceof ModeError) return c.json({ error: e.message }, e.status);
        throw e;
      }
      if (input.modesEnabled !== phone.modesEnabled) await wakePhone(ctx, phone.id, "rules");
    }
    const fields = {
      ...(rulesField ? nextRulesRevision() : {}),
      ...(weeklySummaryEnabled !== undefined ? { weeklySummaryEnabled } : {}),
      ...(changeReceiptsEnabled !== undefined ? { changeReceiptsEnabled } : {}),
      ...(healthBoardEnabled !== undefined ? { healthBoardEnabled } : {}),
      ...(silentBedtime !== undefined ? { silentBedtime } : {}),
      ...(pinApprovalEnabled !== undefined ? { pinApprovalEnabled } : {}),
      ...(appUpdatesEnabled !== undefined ? { appUpdatesEnabled } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.supportEnabled !== undefined ? { supportEnabled: input.supportEnabled } : {}),
      ...(input.releaseWarningsEnabled !== undefined ? { releaseWarningsEnabled: input.releaseWarningsEnabled } : {}),
      ...(input.askMoreTimeEnabled !== undefined ? { askMoreTimeEnabled: input.askMoreTimeEnabled } : {}),
      ...(input.limitWarningEnabled !== undefined ? { limitWarningEnabled: input.limitWarningEnabled } : {}),
      ...(input.pushWakeups === undefined ? {} : { pushWakeups: input.pushWakeups }),
      ...(input.preferUnifiedPush === undefined ? {} : { preferUnifiedPush: input.preferUnifiedPush }),
      ...(input.preferUnifiedPush === true ? { fcmToken: null, fcmValidationKey: null } : {}),
      ...(input.pushWakeups === false ? { fcmToken: null, fcmValidationKey: null, unifiedPushEndpoint: null } : {}),
      ...(input.language !== undefined ? { language: input.language } : {}),
      ...(input.lockSystemLanguage !== undefined ? { lockSystemLanguage: input.lockSystemLanguage } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.offlineAlertHours !== undefined ? { offlineAlertHours: input.offlineAlertHours } : {}),
    };
    if (Object.keys(fields).length) {
      const updated = await ctx.db.transaction(async (tx) => {
        const [current] = await tx.select().from(phones).where(eq(phones.id, phone.id)).for("update");
        if (!current || (input.timezone !== undefined && (
          current.mode !== "strong" || current.pairedAt !== null || current.deviceTokenHash !== null
        ))) return false;
        await tx.update(phones).set(fields).where(eq(phones.id, phone.id));
        if ((input.language !== undefined && input.language !== current.language)
          || (input.timezone !== undefined && input.timezone !== current.timezone)) {
          await invalidateEnrollments(tx, phone.id, ctx.now());
        }
        return true;
      });
      if (input.timezone !== undefined && !updated) return c.json({ error: "time zone can only be set before strong setup" }, 409);
    }
    // The time-limit switches reach the phone's stop screen, so tell it now.
    if ((input.askMoreTimeEnabled !== undefined && input.askMoreTimeEnabled !== phone.askMoreTimeEnabled) ||
        (input.limitWarningEnabled !== undefined && input.limitWarningEnabled !== phone.limitWarningEnabled)) {
      await wakePhone(ctx, phone.id, "rules");
    }
    // The boolean predates the location modes: on means the child default, off means off.
    if (input.locationEnabled !== undefined && input.locationEnabled !== phone.locationEnabled) {
      await setLocationMode(ctx, phone, input.locationEnabled ? "checkin" : "off");
    }
    const [updated] = await ctx.db.select().from(phones).where(eq(phones.id, phone.id));
    if (rulesField) {
      await wakePhone(ctx, phone.id, "rules");
    }
    return c.json(await phoneSummary(ctx, updated!));
  });

  // On a Self phone this goes through the key: otherwise the owner could remove the
  // phone and pair it again as a Child phone, which has no key.
  app.delete("/phones/:pid", async (c) => {
    const phone = await requirePhone(c);
    return change(c, phone, { type: "phone.remove", dnsClientId: phone.dnsClientId });
  });

  // Switches Plainphone off on the phone, like the phone's own maintenance screen does. The
  // phone then calls POST /device/released and disappears from the dashboard. It goes through
  // the key on a Self phone, like removing it.
  app.post("/phones/:pid/release", async (c) => {
    const phone = await requirePhone(c);
    return change(c, phone, { type: "phone.release" });
  });

  // Requests from the phone: an app from its list, or a contact.
  app.get("/phones/:pid/requests", async (c) => {
    const phone = await requirePhone(c);
    return c.json({ requests: await openRequests(ctx, [phone.id]), recent: await recentAnswers(ctx, phone.id) });
  });

  app.post("/phones/:pid/requests/:rid/approve", async (c) => {
    const phone = await requirePhone(c);
    const input = await body(c, z.object({ name: z.string().trim().min(1).max(60).optional() }));
    try {
      const r = await approveRequest(ctx, phone, param(c, "rid"), c.get("user").id, input);
      return c.json(changeJson(r), r.status === "applied" ? 200 : 202);
    } catch (err) {
      if (err instanceof RequestError) return c.json({ error: err.message, ...(err.outcome && { outcome: err.outcome }) }, err.status);
      if (err instanceof ChangeError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  });

  app.post("/phones/:pid/requests/:rid/reject", async (c) => {
    const phone = await requirePhone(c);
    try {
      await rejectRequest(ctx, phone, param(c, "rid"), c.get("user").id);
      return c.body(null, 204);
    } catch (err) {
      if (err instanceof RequestError) return c.json({ error: err.message, ...(err.outcome && { outcome: err.outcome }) }, err.status);
      throw err;
    }
  });

  // Whether this parent gets notifications about this phone (default on).
  app.put("/phones/:pid/notifications", async (c) => {
    const phone = await requirePhone(c);
    const input = await body(c, z.object({ enabled: z.boolean() }));
    const userId = c.get("user").id;
    if (input.enabled) {
      await ctx.db
        .delete(notificationMutes)
        .where(and(eq(notificationMutes.userId, userId), eq(notificationMutes.phoneId, phone.id)));
    } else {
      await ctx.db.insert(notificationMutes).values({ userId, phoneId: phone.id }).onConflictDoNothing();
    }
    return c.body(null, 204);
  });

  // Apps
  app.get("/phones/:pid/apps", async (c) => {
    const phone = await requirePhone(c);
    const rows = await ctx.db
      .select()
      .from(phoneApps)
      .where(and(eq(phoneApps.phoneId, phone.id), (phone.pairedAt ? eq(phoneApps.installed, true) : undefined)))
      .orderBy(phoneApps.label);
    // In open mode an app is blocked one by one (`blocked`) or with its category (`blockedBy`).
    const via = (pkg: string) => (phone.openMode ? categoryOf(pkg, phone.blockedAppCategories) : undefined);
    return c.json({
      apps: rows.map((a) => ({
        packageName: a.packageName,
        label: a.label,
        allowed: a.allowed,
        blocked: !a.core && (a.explicitlyBlocked || via(a.packageName) !== undefined),
        ...(!a.core && via(a.packageName) ? { blockedBy: via(a.packageName) } : {}),
        core: a.core,
      })),
    });
  });

  app.put("/phones/:pid/apps/:package", async (c) => {
    const phone = await requirePhone(c);
    const pkg = v.packageName.safeParse(c.req.param("package"));
    if (!pkg.success) throw new HTTPException(404, { message: "not found" });
    const input = await body(c, z.object({ allowed: z.boolean() }));
    return change(c, phone, { type: "app.set", packageName: pkg.data, allowed: input.allowed });
  });

  // Open mode: every app allowed except the block list (docs/open-mode.md)
  app.get("/phones/:pid/open-mode", async (c) => {
    const phone = await requirePhone(c);
    const [dns] = await ctx.db.select().from(dnsSettings).where(eq(dnsSettings.phoneId, phone.id));
    const apps = await ctx.db
      .select({ packageName: phoneApps.packageName, label: phoneApps.label })
      .from(phoneApps)
      .where(and(eq(phoneApps.phoneId, phone.id), eq(phoneApps.installed, true), eq(phoneApps.explicitlyBlocked, true), eq(phoneApps.core, false)))
      .orderBy(phoneApps.label);
    c.header("Cache-Control", "no-store");
    return c.json({
      enabled: phone.openMode,
      categories: OPEN_CATEGORIES.map((category) => ({
        category,
        // Blocked when either half is: the DNS category or the apps (the apps half also marks
        // the app list). Turning it off clears both, so the switch never hides a block.
        blocked: (dns?.blockedCategories ?? []).includes(category) ||
          (isAppCategory(category) && phone.blockedAppCategories.includes(category)),
        hasApps: isAppCategory(category),
      })),
      blockedApps: apps,
    });
  });

  app.put("/phones/:pid/open-mode", async (c) => {
    const phone = await requirePhone(c);
    const { enabled } = await body(c, z.strictObject({ enabled: z.boolean() }));
    return change(c, phone, { type: "openMode.set", enabled });
  });

  app.put("/phones/:pid/open-mode/categories/:category", async (c) => {
    const phone = await requirePhone(c);
    const category = z.enum(OPEN_CATEGORIES).safeParse(c.req.param("category"));
    if (!category.success) throw new HTTPException(404, { message: "unknown category" });
    const input = await body(c, z.strictObject({ blocked: z.boolean() }));
    return change(c, phone, { type: "openMode.category", category: category.data, blocked: input.blocked });
  });

  // Phone settings and the home screen (docs/phone-settings.md)
  app.get("/phones/:pid/settings", async (c) => {
    const phone = await requirePhone(c);
    return c.json({ settings: (await loadPhoneSettings(ctx.db, phone.id)).settings });
  });

  app.put("/phones/:pid/settings/:key", async (c) => {
    const phone = await requirePhone(c);
    const key = c.req.param("key");
    if (!isSettingKey(key)) throw new HTTPException(404, { message: "unknown setting" });
    const setting = await body(c, settingBody(key));
    return change(c, phone, { type: "setting.set", key, setting });
  });

  app.get("/phones/:pid/home", async (c) => {
    const phone = await requirePhone(c);
    return c.json((await loadPhoneSettings(ctx.db, phone.id)).home);
  });

  // Never waits for the key: the home screen only arranges apps the rules already allow.
  app.put("/phones/:pid/home", async (c) => {
    const phone = await requirePhone(c);
    const home = await body(c, homeInput);
    return change(c, phone, { type: "home.set", home });
  });
  app.patch("/phones/:pid/home", async (c) => {
    const phone = await requirePhone(c);
    const home = await body(c, homePromiseInput);
    return change(c, phone, { type: "home.set", home });
  });
  // Time limits and the app catalog (routes/limits.ts, routes/catalog.ts)
  limitRoutes(app, ctx, { requirePhone, change });
  modeRoutes(app, ctx, { requirePhone });
  summaryRoutes(app, ctx, { requireMember });
  parentMoreTimeRoutes(app, ctx, { requirePhone, userId: (c) => c.get("user").id });
  locationRoutes(app, ctx, { requirePhone, userId: (c) => c.get("user").id });
  parentSosRoutes(app, ctx, requirePhone);
  parentAgeRoutes(app, ctx, requirePhone);
  phoneCatalogRoutes(app, ctx, { requirePhone, change });

  // Contacts
  app.get("/phones/:pid/contact-suggestions", async (c) => {
    const phone = await requirePhone(c);
    if (phone.profile !== "child") throw new HTTPException(404, { message: "not found" });
    return c.json({ suggestions: await pendingContactSuggestions(ctx, phone.id) });
  });

  app.post("/phones/:pid/contact-suggestions", bodyLimit({ maxSize: 4 * 1024 * 1024 }), async (c) => {
    const phone = await requirePhone(c);
    if (phone.profile !== "child") throw new HTTPException(404, { message: "not found" });
    await reviewContactSuggestions(ctx, phone.id, await body(c, reviewContactSuggestionsInput));
    return c.body(null, 204);
  });

  app.put("/phones/:pid/contact-schedule", async (c) => {
    const phone = await requirePhone(c);
    const { restricted } = await body(c, z.strictObject({ restricted: z.boolean() }));
    return change(c, phone, { type: "contact.schedule", restricted });
  });

  app.get("/phones/:pid/contacts", async (c) => {
    const phone = await requirePhone(c);
    const rows = await ctx.db.select().from(contacts).where(eq(contacts.phoneId, phone.id)).orderBy(contacts.name);
    return c.json({
      contacts: rows.map((r) => ({ id: r.id, name: r.name, number: r.number, group: r.sosParent ? "family" : r.contactGroup, ...(r.sosParent ? { sosParent: true } : {}) })),
      selfScheduleContacts: phone.selfScheduleContacts,
      suggestDeviceContacts: phone.profile === "child" && phone.suggestDeviceContacts,
      lightContactRestriction: phone.mode === "light" && phone.profile === "child" && phone.lightContactRestriction,
    });
  });

  app.patch("/phones/:pid/contacts", async (c) => {
    const phone = await requirePhone(c);
    if (phone.profile !== "child") throw new HTTPException(404, { message: "not found" });
    const input = await body(c, childContactSettingsInput);
    if (input.lightContactRestriction !== undefined && phone.mode !== "light") {
      throw new HTTPException(400, { message: "contact restriction is always on in strong mode" });
    }
    const settings = await updateChildContactSettings(ctx, phone.id, input);
    if (!settings) throw new HTTPException(404, { message: "not found" });
    return c.json(settings);
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
    c.header("Cache-Control", "no-store");
    return c.json({
      host: isDnsReady(ctx, phone)
        ? `${phone.dnsClientId}.${ctx.cfg.DNS_HOST_SUFFIX}`
        : null,
      rulesReady: isRulesDnsReady(ctx, phone),
      synced: !phone.dnsDirty,
      filterMethod: phone.filterMethod,
      blockedCategories: row?.blockedCategories ?? [],
      allowDomains: row?.allowDomains ?? [],
      blockDomains: row?.blockDomains ?? [],
    });
  });

  app.put("/phones/:pid/dns/method", async (c) => {
    const phone = await requirePhone(c);
    if (phone.mode !== "light") throw new HTTPException(409, { message: "only light phones can change filter method" });
    const { method } = await body(c, z.strictObject({ method: z.enum(FILTER_METHODS) }));
    return change(c, phone, { type: "dns.method", method });
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

  app.post("/phones/:pid/update", async (c) => {
    const phone = await requirePhone(c);
    if (!wakeLimit.take(`update:${phone.id}`)) throw new HTTPException(429, { message: "too many update requests; wait a few minutes" });
    const requestedAt = ctx.now();
    await ctx.db.update(phones).set({ updateRequestedAt: requestedAt }).where(eq(phones.id, phone.id));
    updateWake.notify(phone.id, requestedAt.getTime());
    await wakePhone(ctx, phone.id, "update");
    return c.body(null, 202);
  });

  // "Update apps now" (docs/policies.md, "App updates"): the phone opens its app update window.
  app.post("/phones/:pid/app-updates", async (c) => {
    const phone = await requirePhone(c);
    if (phone.mode !== "strong") return c.json({ error: "app update windows are only needed in strong mode" }, 409);
    if (!wakeLimit.take(`apps:${phone.id}`)) throw new HTTPException(429, { message: "too many update requests; wait a few minutes" });
    await ctx.db.update(phones).set({ appUpdatesRequestedAt: ctx.now() }).where(eq(phones.id, phone.id));
    await wakePhone(ctx, phone.id, "rules");
    return c.body(null, 202);
  });

  app.get("/phones/:pid/setup-undo", async (c) => {
    const phone = await requirePhone(c);
    const deadline = setupUndoDeadline(phone);
    return c.json({
      minutes: phone.setupUndoMinutes ?? DEFAULT_SETUP_UNDO_MINUTES,
      undoUntil: deadline === null ? null : new Date(deadline).toISOString(),
      editable: phone.mode === "light" && !phone.deviceTokenHash && !phone.pairedAt && !phone.setupCompletedAt,
    });
  });

  app.put("/phones/:pid/setup-undo", async (c) => {
    const phone = await requirePhone(c);
    const { minutes } = await body(c, z.object({ minutes: undoMinutesInput }));
    const [updated] = await ctx.db.update(phones).set({ setupUndoMinutes: minutes }).where(and(
      eq(phones.id, phone.id), eq(phones.mode, "light"),
      isNull(phones.deviceTokenHash), isNull(phones.pairedAt), isNull(phones.setupCompletedAt),
    )).returning({ id: phones.id });
    if (!updated) return c.json({ error: "setup undo can only be changed before pairing" }, 409);
    return c.json({ minutes, editable: true });
  });

  // Self key (D12, D13)
  app.get("/phones/:pid/key", async (c) => {
    const phone = await requirePhone(c);
    if (phone.profile !== "self") return c.json({ error: "only Self phones have a key" }, 404);
    const [k] = await ctx.db.select().from(selfKeys).where(eq(selfKeys.phoneId, phone.id));
    return c.json({ ...keyJson(k!), emergency: await emergencyState(ctx.db, phone, ctx.now()) });
  });

  // Limited emergency openings (docs/emergency-openings.md). More openings, or switching them on,
  // loosen the rules, so on a connected Self phone they wait for the key like any loosening.
  app.get("/phones/:pid/emergency-openings", async (c) => {
    const phone = await requirePhone(c);
    if (phone.profile !== "self") return c.json({ error: "only Self phones have emergency openings" }, 404);
    c.header("Cache-Control", "no-store");
    return c.json({ ...(await emergencyState(ctx.db, phone, ctx.now())), openings: await listOpenings(ctx.db, phone, ctx.now()) });
  });

  app.put("/phones/:pid/emergency-openings", async (c) => {
    const phone = await requirePhone(c);
    if (phone.profile !== "self") return c.json({ error: "only Self phones have emergency openings" }, 404);
    const input = await body(c, emergencyInput);
    return change(c, phone, { type: "emergency.set", ...input });
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

  app.post("/phones/:pid/self-template", async (c) => {
    const phone = await requirePhone(c);
    if (!selfTemplateLimit.take(c.get("user").id)) throw new HTTPException(429, { message: "too many setup templates" });
    const template = await shareSelfTemplate(ctx, phone);
    if (!template) return c.json({ error: "this phone cannot share a template right now" }, 409);
    c.header("Cache-Control", "no-store");
    return c.json(template, 201);
  });

  app.post("/phones/:pid/trusted-invite", async (c) => {
    const phone = await requirePhone(c);
    const invite = await issueTrustedInvite(ctx, phone.id, { userId: c.get("user").id });
    if (!invite) return c.json({ error: "this phone cannot invite a helper right now" }, 409);
    c.header("Cache-Control", "no-store");
    return c.json(invite, 201);
  });

  // Pending changes
  app.get("/phones/:pid/changes", async (c) => {
    const phone = await requirePhone(c);
    const [k] = await ctx.db.select().from(selfKeys).where(eq(selfKeys.phoneId, phone.id));
    const rows = await listPending(ctx, [phone.id]);
    return c.json({ changes: await Promise.all(rows.map((r) => pendingJson(r, phone, k))) });
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
  async function requireTrusted(c: Context<ParentEnv>) {
    const cid = param(c, "cid");
    const [row] = await ctx.db
      .select({ change: pendingChanges })
      .from(pendingChanges)
      .innerJoin(phones, eq(phones.id, pendingChanges.phoneId))
      .innerJoin(selfKeys, eq(selfKeys.phoneId, pendingChanges.phoneId))
      .where(
        and(
          eq(pendingChanges.id, cid),
          eq(pendingChanges.keyType, "trusted"),
          eq(selfKeys.trustedUserId, c.get("user").id),
          eq(selfKeys.keyType, "trusted"),
          eq(phones.profile, "self"),
          sql`${pendingChanges.requestedBy} is distinct from ${c.get("user").id}`,
          notExists(ctx.db.select().from(householdMembers).where(and(
            eq(householdMembers.householdId, phones.householdId),
            eq(householdMembers.userId, c.get("user").id),
          ))),
        ),
      );
    if (!row) throw new HTTPException(404, { message: "not found" });
    return row.change;
  }

  app.get("/people-i-help", async (c) => {
    const helper = c.get("user").id;
    // One row per phone: with several owners in the household, the one who joined first.
    const rows = await ctx.db.selectDistinctOn([phones.id], { id: phones.id, name: phones.name, owner: users.email })
      .from(selfKeys)
      .innerJoin(phones, eq(phones.id, selfKeys.phoneId))
      .innerJoin(householdMembers, and(eq(householdMembers.householdId, phones.householdId), eq(householdMembers.role, "owner")))
      .innerJoin(users, eq(users.id, householdMembers.userId))
      .where(and(eq(selfKeys.keyType, "trusted"), eq(selfKeys.trustedUserId, helper), eq(phones.profile, "self"),
        sql`not exists (select 1 from household_members as helper_membership
          where helper_membership.household_id = ${phones.householdId} and helper_membership.user_id = ${helper})`,
      )).orderBy(phones.id, householdMembers.createdAt);
    const people = rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    // What the helper sees of the phone's emergency openings: the switch, this month's use and the recent ones.
    const now = ctx.now();
    const withEmergency = await Promise.all(people.map(async (p) => {
      const [phone] = await ctx.db.select().from(phones).where(eq(phones.id, p.id));
      const state = await emergencyState(ctx.db, phone!, now);
      return { ...p, emergency: { ...state, openings: (await listOpenings(ctx.db, phone!, now)).slice(0, 10) } };
    }));
    return c.json({ people: withEmergency });
  });

  app.get("/approvals", async (c) => {
    const rows = await ctx.db
      .select({ change: pendingChanges, phoneName: phones.name, timezone: phones.timezone, requester: users.email })
      .from(pendingChanges)
      .innerJoin(selfKeys, eq(selfKeys.phoneId, pendingChanges.phoneId))
      .innerJoin(phones, eq(phones.id, pendingChanges.phoneId))
      .leftJoin(users, eq(users.id, pendingChanges.requestedBy))
      .where(
        and(
          eq(selfKeys.trustedUserId, c.get("user").id),
          eq(selfKeys.keyType, "trusted"),
          eq(phones.profile, "self"),
          sql`${pendingChanges.requestedBy} is distinct from ${c.get("user").id}`,
          notExists(ctx.db.select().from(householdMembers).where(and(
            eq(householdMembers.householdId, phones.householdId),
            eq(householdMembers.userId, c.get("user").id),
          ))),
          eq(pendingChanges.keyType, "trusted"),
          eq(pendingChanges.status, "pending"),
        ),
      )
      .orderBy(desc(pendingChanges.createdAt));
    const targets = rows.map((row) => ({ ...row, phoneId: row.change.phoneId, op: row.change.op as Op }));
    const state = await loadApprovalSummaries(ctx.db, targets);
    const now = ctx.now();
    c.header("Cache-Control", "no-store");
    return c.json({
      approvals: targets.map((r) => {
        const id = r.change.id;
        const bonusDate = r.op.type === "timeLimit.bonus" ? approvalBonusDate(r, now) : undefined;
        const summary = formatApprovalSummary(state, r.phoneId, r.op, { id, bonusDate });
        return {
          id,
          phoneId: r.phoneId,
          phoneName: r.phoneName,
          requestedBy: r.requester,
          op: { type: r.op.type },
          appLabel: approvalAppLabel(state, r.phoneId, r.op),
          summary,
          revision: approvalRevision(r.change, state, r.phoneId, r.op, bonusDate),
          createdAt: r.change.createdAt.toISOString(),
        };
      }),
    });
  });

  const revision = z.string().regex(/^[0-9a-f]{64}$/);
  app.post("/changes/:cid/approve-qr", async (c) => {
    const change = await requireTrusted(c);
    const approval = await body(c, z.object({ challenge: z.string().max(240), revision }));
    const r = await applyPending(ctx, change.id, c.get("user").id, approval);
    if (r === "gone") {
      const d = await explainDecision(ctx, change.id, c.get("user").id, "approve", approval.challenge);
      if (!d.ok) return c.json({ error: "the approval code or preview is no longer valid", outcome: d.outcome }, 409);
    }
    return c.body(null, 204);
  });

  app.post("/changes/:cid/approve", async (c) => {
    const change = await requireTrusted(c);
    const approval = await body(c, z.object({ revision }));
    const r = await applyPending(ctx, change.id, c.get("user").id, approval);
    if (r === "gone") {
      const d = await explainDecision(ctx, change.id, c.get("user").id, "approve");
      if (!d.ok) return c.json({ error: "the approval preview is no longer valid", outcome: d.outcome }, 409);
    }
    return c.body(null, 204);
  });

  app.post("/changes/:cid/reject", async (c) => {
    const change = await requireTrusted(c);
    if (!(await rejectTrustedChange(ctx, change.id, change.phoneId, c.get("user").id))) {
      const d = await explainDecision(ctx, change.id, c.get("user").id, "reject");
      if (!d.ok) return c.json({ error: "this change is no longer pending", outcome: d.outcome }, 409);
    }
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

  async function pendingJson(
    r: typeof pendingChanges.$inferSelect,
    phone: Phone,
    key: typeof selfKeys.$inferSelect | undefined,
  ) {
    const op = r.op as Op;
    const state = await loadApprovalSummaries(ctx.db, [{ phoneId: phone.id, op }]);
    const now = ctx.now();
    const appliesAt = r.effectiveAt && r.effectiveAt > now ? r.effectiveAt : now;
    return {
      id: r.id,
      op,
      // The owner already receives contact details and can see them in the pending list.
      summary: op.type === "contact.add" ? undefined : formatApprovalSummary(state, phone.id, op, {
        id: r.id, owner: true, bonusDate: approvalBonusDate(phone, appliesAt),
      }),
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
    /** mild, firm, strict or custom: a name for the key, derived (docs/self-keys.md). */
    level: selfLevel(k),
    trustedEmail: k.trustedEmail,
    trustedAccepted: Boolean(k.trustedUserId),
    payUnlockEnabled: k.payUnlockEnabled,
    payUnlockAmount: k.payUnlockAmount,
    payUnlockCurrency: k.payUnlockCurrency,
    payUnlockRecipient: k.payUnlockRecipient,
  };
}
