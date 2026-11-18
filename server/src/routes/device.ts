// SPDX-License-Identifier: Apache-2.0
//
// The API the phone talks to. Contract: server/openapi.yaml, tag "device".

import { and, eq, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { enrollments, households, pairings, pendingChanges, phoneApps, phones, selfKeys, users, PROTECTIONS, safetyRequests, UPDATE_ERROR_CODES } from "../db/schema.js";
import { pairingCode, randomToken, safeEqualHex, sha256 } from "../lib/crypto.js";
import { body, clientIp, RateLimiter } from "../lib/http.js";
import { issueApprovalChallenge } from "../lib/approval-challenge.js";
import { DEFAULT_SETUP_UNDO_MINUTES, MAX_SETUP_UNDO_MS, undoMinutesInput } from "../lib/setup-undo.js";
import { packageName, phoneNumber } from "../lib/validation.js";
import { applyDueChanges, deletePhone } from "../services/changes.js";
import { pairingAccount, PAIRING_RECOVERY_MS } from "../services/pairing-account.js";
import { retryDnsDeletions, syncDns } from "../services/dns.js";
import { ENROLLMENT_PREFIX, redeemEnrollment } from "../services/enrollment.js";
import { initialSelfKey, sendInitialKeyInvite, setInitialSelfKey, type InitialSelfKey } from "../services/initial-self-key.js";
import { issueTrustedInvite } from "../services/trusted-invites.js";
import { readSelfTemplate, replaceDraftTemplate, shareSelfTemplate, templateCode } from "../services/self-template.js";
import type { Ctx } from "../services/context.js";
import { phoneCountry, STARTER_PACKS } from "../services/catalog.js";
import { limitTarget } from "../services/limits.js";
import { notifyHousehold, notifyHouseholdMembers, phoneAlertRecipients, protectionLost } from "../services/notifications.js";
import { installOverrunFromStatus, isInstallOverrun, parallelAppsRemovalFromStatus, respondWithRules, withAttestation } from "../services/phones.js";
import { checkinLocationDue, FIND_WINDOW_MS, legacyUntaggedTargets, notifySafety, storeLatestLocation } from "../services/safety.js";
import { createRequest, phoneRequestList, RequestError, requestJson } from "../services/requests.js";

import type { UpdateWake } from "../services/update-wake.js";

export const PAIRING_MINUTES = 15;

const SETUP_COMPLETION_LIMIT_MS = MAX_SETUP_UNDO_MS;

function setupUndoRemaining(phone: Phone, now: Date): number {
  if (phone.mode !== "light" || !phone.setupCompletedAt || phone.setupUndoAuthorizedAt) return 0;
  const duration = undoMinutesInput.safeParse(phone.setupUndoMinutes ?? DEFAULT_SETUP_UNDO_MINUTES);
  if (!duration.success) return 0;
  return Math.min(duration.data * 60_000, Math.max(0, phone.setupCompletedAt.getTime() + duration.data * 60_000 - now.getTime()));
}
export const DEVICE_PREFIX = "pp_d_";

type Phone = typeof phones.$inferSelect;
type Env = { Variables: { phone: Phone } };

const deviceInfo = z.record(z.string().max(40), z.string().max(200)).refine((r) => Object.keys(r).length <= 20);

function starterPack(timezone: string): Set<string> {
  // Good enough until the parent picks a country: Danish time zone means Danish pack.
  const country = phoneCountry(timezone);
  return new Set(country ? STARTER_PACKS[country] : []);
}

/** Light mode cannot be intact without these (docs/sync-api.md). */
const LIGHT_LOCK = ["deviceAdmin", "accessibility", "usageAccess", "vpn", "phoneRole", "smsRole"] as const;

const protections = z.strictObject(Object.fromEntries(PROTECTIONS.map((k) => [k, z.boolean().optional()]))) as z.ZodType<
  Partial<Record<(typeof PROTECTIONS)[number], boolean>>
>;

export function deviceRoutes(ctx: Ctx, updateWake: UpdateWake, extra?: (app: Hono<Env>) => void) {
  const app = new Hono<Env>();
  const pairStartLimit = new RateLimiter(10, 60 * 60_000);
  const pairPollLimit = new RateLimiter(320, 60 * 60_000);
  const enrollLimit = new RateLimiter(20, 60 * 60_000);
  const selfTemplateLimit = new RateLimiter(20, 60 * 60_000);

  // --- Pairing (no device token yet) -------------------------------------------

  app.post("/pairings", async (c) => {
    if (!pairStartLimit.take(clientIp(c, ctx.cfg.TRUST_PROXY))) throw new HTTPException(429, { message: "too many pairings" });
    const input = await body(
      c,
      z.object({ mode: z.enum(["strong", "light"]).default("strong"), deviceInfo: deviceInfo.optional(), profile: z.enum(["child", "self"]).optional(), confirmOnPhone: z.boolean().optional() }),
    );
    const code = pairingCode();
    const pollSecret = randomToken();
    const expiresAt = new Date(ctx.now().getTime() + PAIRING_MINUTES * 60_000);
    const [p] = await ctx.db
      .insert(pairings)
      .values({
        codeHash: sha256(code),
        pollSecretHash: sha256(pollSecret),
        mode: input.mode,
        deviceInfo: input.deviceInfo ?? null,
        expiresAt,
        profileHint: input.profile,
        requiresConfirmation: input.confirmOnPhone ?? false,
      })
      .returning();
    return c.json(
      {
        pairingId: p!.id,
        confirmOnPhone: p!.requiresConfirmation,
        code,
        pollSecret,
        expiresAt: expiresAt.toISOString(),
        // What the phone renders as a QR code: the parent's camera opens the PWA with the code filled in.
        qrUrl: `${ctx.cfg.PUBLIC_URL}/pair?code=${encodeURIComponent(code)}${input.profile ? `&profile=${input.profile}` : ""}`,
      },
      201,
    );
  });

  const pairingPoll = async (id: string, secret: string, action?: "confirm" | "cancel", key?: InitialSelfKey) => {
    if (!z.uuid().safeParse(id).success) return { status: 404 as const };
    return ctx.db.transaction(async (tx) => {
      const [p] = await tx.select().from(pairings).where(eq(pairings.id, id)).for("update");
      if (!p || !safeEqualHex(p.pollSecretHash, sha256(secret))) return { status: 404 as const };
      if (action === "cancel" && !p.deliveredAt) {
        const clientId = p.phoneId ? await deletePhone(tx, p.phoneId) : null;
        await tx.delete(pairings).where(eq(pairings.id, id));
        return { status: 204 as const, clientId };
      }
      if (action === "cancel") return { status: 410 as const };
      if (!p.claimedAt) return { status: p.expiresAt <= ctx.now() ? 410 as const : 202 as const };
      if (!p.pendingDeviceToken || !p.phoneId) return { status: 410 as const };
      if (p.requiresConfirmation) {
        const deadline = p.deliveredAt ? p.deliveredAt.getTime() + PAIRING_RECOVERY_MS : p.expiresAt.getTime();
        if (deadline <= ctx.now().getTime()) return { status: 410 as const };
      }
      if (p.requiresConfirmation && !p.deliveredAt && action !== "confirm") {
        const [account] = p.claimedBy
          ? await tx.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, p.claimedBy))
          : [];
        const [household] = await tx.select({ name: households.name }).from(phones)
          .innerJoin(households, eq(phones.householdId, households.id)).where(eq(phones.id, p.phoneId));
        const details = pairingAccount(p.claimedBy, account, household?.name ?? null);
        return details ? { status: 202 as const, details } : { status: 410 as const };
      }
      if (p.requiresConfirmation && !p.deliveredAt) {
        if (!p.claimedBy) return { status: 410 as const };
        if (key) {
          const [phone] = await tx.select().from(phones).where(eq(phones.id, p.phoneId)).for("update");
          if (!phone || !(await setInitialSelfKey(tx, phone, key))) return { status: 400 as const };
        }
        await tx.update(phones).set({ deviceTokenHash: sha256(p.pendingDeviceToken) })
          .where(eq(phones.id, p.phoneId));
      }
      // New clients may retry confirmation after losing the response. The secret is still required,
      // including after the original code expires. The sweeper bounds retention.
      await tx.update(pairings)
        .set({ pendingDeviceToken: p.requiresConfirmation ? p.pendingDeviceToken : null, deliveredAt: p.deliveredAt ?? ctx.now() })
        .where(eq(pairings.id, id));
      return { status: 200 as const, phoneId: p.phoneId, deviceToken: p.pendingDeviceToken, sync: p.requiresConfirmation && !p.deliveredAt, ownerId: p.claimedBy };
    });
  };

  app.on(["GET", "POST"], "/pairings/:id", async (c) => {
    const id = c.req.param("id");
    if (!pairPollLimit.take(`${clientIp(c, ctx.cfg.TRUST_PROXY)}:${id}`)) throw new HTTPException(429, { message: "slow down" });
    const decision = c.req.method === "POST" ? await body(c, z.object({ action: z.enum(["confirm", "cancel"]), key: initialSelfKey.optional() })) : undefined;
    const result = await pairingPoll(id, c.req.header("x-poll-secret") ?? "", decision?.action, decision?.key);
    c.header("Cache-Control", "no-store");
    if (result.status === 404) throw new HTTPException(404, { message: "not found" });
    if (result.status === 410) return c.json({ error: "expired" }, 410);
    if (result.status === 400) return c.json({ error: "invalid setup key" }, 400);
    if (result.status === 204) {
      if (result.clientId) await retryDnsDeletions(ctx, [result.clientId]);
      return c.body(null, 204);
    }
    if (result.status === 202) return c.json(result.details ? { status: "confirm", ...result.details } : { status: "waiting" }, 202);
    if (result.sync) {
      await syncDns(ctx, result.phoneId);
      await sendInitialKeyInvite(ctx, decision?.key, result.ownerId);
    }
    return c.json({ status: "paired", phoneId: result.phoneId, deviceToken: result.deviceToken }, 200);
  });

  app.post("/enrollment-review", async (c) => {
    if (!enrollLimit.take(clientIp(c, ctx.cfg.TRUST_PROXY))) throw new HTTPException(429, { message: "too many attempts" });
    const input = await body(c, z.object({
      token: z.string().startsWith(ENROLLMENT_PREFIX).max(100),
      mode: z.enum(["light", "strong"]),
      cancel: z.boolean().optional(),
    }));
    const result = await ctx.db.transaction(async (tx) => {
      const [e] = await tx.select().from(enrollments).where(eq(enrollments.tokenHash, sha256(input.token))).for("update");
      if (!e || e.usedAt || (!input.cancel && e.expiresAt <= ctx.now())) return null;
      const [phone] = await tx.select().from(phones).where(eq(phones.id, e.phoneId)).for("update");
      if (!phone || phone.mode !== input.mode || phone.deviceTokenHash) return null;
      if (input.cancel) return { clientId: await deletePhone(tx, phone.id) };
      const [account] = e.createdBy
        ? await tx.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, e.createdBy))
        : [];
      const [household] = await tx.select({ name: households.name }).from(households).where(eq(households.id, phone.householdId));
      const details = pairingAccount(e.createdBy, account, household?.name ?? null);
      return details ? { ...details, profile: phone.profile } : null;
    });
    c.header("Cache-Control", "no-store");
    if (!result) return c.json({ error: "setup link unavailable" }, 404);
    if ("clientId" in result) {
      if (result.clientId) await retryDnsDeletions(ctx, [result.clientId]);
      return c.body(null, 204);
    }
    return c.json(result);
  });

  // A phone with a setup link can copy rules into that same draft before connecting.
  app.post("/enrollment-template", async (c) => {
    if (!enrollLimit.take(clientIp(c, ctx.cfg.TRUST_PROXY))) throw new HTTPException(429, { message: "too many attempts" });
    const input = await body(c, z.object({
      token: z.string().startsWith(ENROLLMENT_PREFIX).max(100),
      template: templateCode,
    }));
    const now = ctx.now();
    const phoneId = await ctx.db.transaction(async (tx) => {
      const [e] = await tx.select().from(enrollments).where(eq(enrollments.tokenHash, sha256(input.token))).for("update");
      if (!e || e.usedAt || e.expiresAt <= now) return null;
      const [phone] = await tx.select().from(phones).where(eq(phones.id, e.phoneId)).for("update");
      if (!phone || phone.mode !== "light" || phone.profile !== "self" || phone.pairedAt || phone.deviceTokenHash) return null;
      const rules = await readSelfTemplate(tx, input.template, now);
      if (!rules) return null;
      await replaceDraftTemplate(tx, phone.id, rules, now);
      return phone.id;
    });
    if (!phoneId) return c.json({ error: "setup link or template unavailable" }, 404);
    await syncDns(ctx, phoneId);
    return c.body(null, 204);
  });

  // Pairing by the one-time token from a dashboard-made provisioning QR code (no code to type).
  app.post("/enroll", async (c) => {
    if (!enrollLimit.take(clientIp(c, ctx.cfg.TRUST_PROXY))) throw new HTTPException(429, { message: "too many attempts" });
    const input = await body(
      c,
      z.object({
        token: z.string().startsWith(ENROLLMENT_PREFIX).max(100),
        installId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
        key: initialSelfKey.optional(),
        deviceInfo: deviceInfo.optional(),
      }),
    );
    const r = await redeemEnrollment(ctx, { ...input, deviceInfo: input.deviceInfo ?? null }, DEVICE_PREFIX);
    if (r.status !== 200) return c.json({ error: r.error }, r.status);
    return c.json({ status: "paired", phoneId: r.phoneId, deviceToken: r.deviceToken }, 200);
  });

  // --- Everything below needs the device token ------------------------------

  app.use("/*", async (c, next) => {
    const auth = c.req.header("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token.startsWith(DEVICE_PREFIX)) throw new HTTPException(401, { message: "device token required" });
    const [phone] = await ctx.db.select().from(phones).where(eq(phones.deviceTokenHash, sha256(token)));
    if (!phone) throw new HTTPException(401, { message: "unknown device; pair again" });
    c.set("phone", phone);
    await next();
  });

  // Routes that live in their own files but need the device token check above.
  extra?.(app);

  app.get("/rules", async (c) => {
    let phone = c.get("phone");
    if (await applyDueChanges(ctx, phone.id)) {
      const [fresh] = await ctx.db.select().from(phones).where(eq(phones.id, phone.id));
      // A delayed removal just took effect: the phone is gone.
      if (!fresh) throw new HTTPException(401, { message: "unknown device; pair again" });
      phone = fresh;
    }
    // The first authenticated sync proves the phone received and saved its token.
    if (!phone.pairedAt) {
      const deviceTokenHash = phone.deviceTokenHash;
      if (!deviceTokenHash) throw new HTTPException(401, { message: "unknown device; pair again" });
      const [activated] = await ctx.db.update(phones)
        .set({ pairedAt: sql`coalesce(${phones.pairedAt}, ${ctx.now().toISOString()}::timestamptz)` })
        .where(and(eq(phones.id, phone.id), eq(phones.deviceTokenHash, deviceTokenHash)))
        .returning();
      if (!activated) throw new HTTPException(401, { message: "unknown device; pair again" });
      phone = activated;
      await ctx.db.update(pairings).set({ pendingDeviceToken: null })
        .where(and(eq(pairings.phoneId, phone.id), eq(pairings.requiresConfirmation, true)));
    }
    // Throttle last-seen writes to one a minute.
    await ctx.db
      .update(phones)
      .set({ lastSeenAt: ctx.now(), offlineAlertedAt: null })
      .where(
        and(
          eq(phones.id, phone.id),
          or(
            isNull(phones.lastSeenAt),
            lt(phones.lastSeenAt, new Date(ctx.now().getTime() - 60_000)),
            // Back after an offline alert: re-arm it at once.
            isNotNull(phones.offlineAlertedAt),
          ),
        ),
      );
    const ifNoneMatch = c.req.header("if-none-match");
    const candidates = ifNoneMatch ? ifNoneMatch.split(",").map((t) => t.trim().replace(/^W\//, "")) : [];
    const { body: rules, etag } = await respondWithRules(ctx, phone, candidates);
    c.header("ETag", etag);
    c.header("Cache-Control", "no-cache");
    if (rules === null) return c.body(null, 304);
    c.header("Content-Type", "application/json");
    return c.body(rules);
  });

  app.get("/update-request", async (c) => {
    const after = z.coerce.number().int().nonnegative().safeParse(c.req.query("after"));
    if (!after.success) return c.json({ error: "invalid update timestamp" }, 400);
    const { id } = c.get("phone");
    c.header("Cache-Control", "no-store");
    const listener = updateWake.listen(id, c.req.raw.signal);
    if (!listener) return c.json({ error: "phone is already waiting" }, 409);
    try {
      // Read after subscribing so the parent cannot update the row between the read and the wait.
      const [p] = await ctx.db.select({ at: phones.updateRequestedAt }).from(phones).where(eq(phones.id, id));
      const stored = p?.at?.getTime() ?? 0;
      const requested = stored > after.data ? stored : await listener.result;
      if (requested && requested > after.data) return c.json({ requestedAtMs: requested });
      return c.body(null, 204);
    } finally {
      listener.cancel();
    }
  });

  // The phone has switched Plainphone off after a release request. The phone is deleted, so
  // its token is unknown from now on (401), which the phone reads as "removed".
  app.post("/released", async (c) => {
    const phone = c.get("phone");
    const result = await ctx.db.transaction(async (tx) => {
      // Locked, so two acknowledgements (a retry after a timeout) cannot both delete.
      const [fresh] = await tx.select().from(phones).where(eq(phones.id, phone.id)).for("update");
      if (!fresh) return { status: 401 as const };
      if (!fresh.releaseRequestedAt) return { status: 409 as const };
      return { status: 204 as const, clientId: await deletePhone(tx, phone.id) };
    });
    if (result.status === 401) throw new HTTPException(401, { message: "unknown device; pair again" });
    if (result.status === 409) return c.json({ error: "this phone has not been asked to release" }, 409);
    // Failures stay queued in dns_deletions and the sweeper retries them.
    if (result.clientId) await retryDnsDeletions(ctx, [result.clientId]);
    return c.body(null, 204);
  });

  app.post("/self-template", async (c) => {
    const phone = c.get("phone");
    if (!selfTemplateLimit.take(phone.id)) throw new HTTPException(429, { message: "too many setup templates" });
    const template = await shareSelfTemplate(ctx, phone);
    if (!template) return c.json({ error: "this phone cannot share a template right now" }, 409);
    c.header("Cache-Control", "no-store");
    return c.json(template, 201);
  });

  app.post("/trusted-invite", async (c) => {
    const phone = c.get("phone");
    const invite = await issueTrustedInvite(ctx, phone.id, { deviceHash: phone.deviceTokenHash });
    if (!invite) return c.json({ error: "this phone cannot invite a helper right now" }, 409);
    c.header("Cache-Control", "no-store");
    return c.json(invite, 201);
  });

  app.get("/approval-challenge", async (c) => {
    const phone = c.get("phone");
    if (phone.profile !== "self") throw new HTTPException(404, { message: "not found" });
    const rows = await ctx.db.select({ id: pendingChanges.id, op: pendingChanges.op,
      appLabel: sql<string | null>`coalesce(${phoneApps.label}, ${pendingChanges.op}->>'packageName')`,
    }).from(pendingChanges)
      .leftJoin(phoneApps, and(
        eq(phoneApps.phoneId, pendingChanges.phoneId),
        eq(phoneApps.packageName, sql`${pendingChanges.op}->>'packageName'`),
      ))
      .innerJoin(selfKeys, eq(selfKeys.phoneId, pendingChanges.phoneId))
      .where(and(
        eq(pendingChanges.phoneId, phone.id), eq(pendingChanges.status, "pending"),
        eq(pendingChanges.keyType, "trusted"), eq(selfKeys.keyType, "trusted"), isNotNull(selfKeys.trustedUserId),
      )).orderBy(pendingChanges.createdAt);
    c.header("Cache-Control", "no-store");
    return c.json({ changes: rows.map(({ id, op, appLabel }) => ({ id, type: (op as { type: string }).type, appLabel })) });
  });

  app.post("/approval-challenge", async (c) => {
    const phone = c.get("phone");
    const { changeId } = await body(c, z.object({ changeId: z.uuid() }));
    if (phone.profile !== "self") throw new HTTPException(404, { message: "not found" });
    const [change] = await ctx.db.select({ id: pendingChanges.id }).from(pendingChanges)
      .innerJoin(selfKeys, eq(selfKeys.phoneId, pendingChanges.phoneId))
      .where(and(
        eq(pendingChanges.id, changeId), eq(pendingChanges.phoneId, phone.id),
        eq(pendingChanges.status, "pending"), eq(pendingChanges.keyType, "trusted"),
        eq(selfKeys.keyType, "trusted"), isNotNull(selfKeys.trustedUserId),
      ));
    if (!change) throw new HTTPException(404, { message: "not found" });
    c.header("Cache-Control", "no-store");
    const challenge = issueApprovalChallenge(phone.id, changeId, ctx.now());
    return c.json({ challenge, url: `${ctx.cfg.PUBLIC_URL.replace(/\/$/, "")}/approvals#code=${challenge}` });
  });

  app.get("/setup-completion", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ undoRemainingMs: setupUndoRemaining(c.get("phone"), ctx.now()) });
  });

  app.post("/setup-completion", async (c) => {
    const { elapsedMs, undoMinutes } = await body(c, z.object({
      elapsedMs: z.number().int().min(0).max(MAX_SETUP_UNDO_MS),
      undoMinutes: undoMinutesInput.optional(),
    }));
    const phone = c.get("phone");
    const remaining = await ctx.db.transaction(async (tx) => {
      const [fresh] = await tx.select().from(phones).where(eq(phones.id, phone.id)).for("update");
      if (!fresh || fresh.mode !== "light" || !fresh.pairedAt || fresh.deviceTokenHash !== phone.deviceTokenHash) return 0;
      const now = ctx.now();
      if (fresh.setupCompletedAt) return setupUndoRemaining(fresh, now);
      if (now.getTime() - fresh.pairedAt.getTime() >= SETUP_COMPLETION_LIMIT_MS) return 0;
      const completedAt = new Date(Math.max(fresh.pairedAt.getTime(), now.getTime() - elapsedMs));
      const setupUndoMinutes = fresh.setupUndoMinutes ??
        (fresh.profile === "self" ? undoMinutes : undefined) ?? DEFAULT_SETUP_UNDO_MINUTES;
      const completion = { setupCompletedAt: completedAt, setupUndoMinutes };
      await tx.update(phones).set(completion).where(eq(phones.id, phone.id));
      return setupUndoRemaining({ ...fresh, ...completion }, now);
    });
    c.header("Cache-Control", "no-store");
    return c.json({ undoRemainingMs: remaining });
  });

  app.post("/undo-setup/authorize", async (c) => {
    const phone = c.get("phone");
    const authorized = await ctx.db.transaction(async (tx) => {
      const [fresh] = await tx.select().from(phones).where(eq(phones.id, phone.id)).for("update");
      if (!fresh || fresh.mode !== "light" || fresh.deviceTokenHash !== phone.deviceTokenHash) return false;
      if (fresh.setupUndoAuthorizedAt) return true;
      const now = ctx.now();
      if (setupUndoRemaining(fresh, now) === 0) return false;
      await tx.update(phones).set({ setupUndoAuthorizedAt: now }).where(eq(phones.id, phone.id));
      return true;
    });
    if (!authorized) return c.json({ error: "setup undo window closed" }, 409);
    return c.body(null, 204);
  });

  app.post("/undo-setup", async (c) => {
    const phone = c.get("phone");
    const removed = await ctx.db.transaction(async (tx) => {
      const [fresh] = await tx.select().from(phones).where(eq(phones.id, phone.id)).for("update");
      if (!fresh) return { status: 204 as const };
      if (fresh.mode !== "light" || !fresh.setupUndoAuthorizedAt || fresh.deviceTokenHash !== phone.deviceTokenHash) return { status: 409 as const };
      const members = await phoneAlertRecipients(tx, phone.id, fresh.householdId);
      return { status: 204 as const, clientId: await deletePhone(tx, phone.id), members, name: fresh.name };
    });
    if (removed.status === 409) return c.json({ error: "setup undo not authorized" }, 409);
    if (removed.members) {
      await notifyHouseholdMembers(ctx, removed.members, { type: "protection", phoneId: phone.id, phoneName: removed.name, reason: "lock" });
    }
    if (removed.clientId) await retryDnsDeletions(ctx, [removed.clientId]);
    return c.body(null, 204);
  });

  app.put("/apps", async (c) => {
    const phone = c.get("phone");
    const input = await body(
      c,
      z.object({
        apps: z
          .array(
            z.object({
              packageName,
              label: z.string().trim().min(1).max(100),
              core: z.boolean().default(false),
            }),
          )
          .max(1000),
      }),
    );
    const pack = starterPack(phone.timezone);
    await ctx.db.transaction(async (tx) => {
      for (const a of input.apps) {
        await tx
          .insert(phoneApps)
          .values({
            phoneId: phone.id,
            packageName: a.packageName,
            label: a.label,
            core: a.core,
            // New apps are hidden unless the phone says they are core or they are in the starter pack.
            allowed: a.core || pack.has(a.packageName),
            installed: true,
            reportedAt: ctx.now(),
          })
          .onConflictDoUpdate({
            target: [phoneApps.phoneId, phoneApps.packageName],
            set: { label: a.label, core: a.core, installed: true, reportedAt: ctx.now() },
          });
      }
      const names = input.apps.map((a) => a.packageName);
      await tx
        .update(phoneApps)
        .set({ installed: false })
        .where(
          and(eq(phoneApps.phoneId, phone.id), names.length ? notInArray(phoneApps.packageName, names) : undefined),
        );
    });
    return c.body(null, 204);
  });

  app.put("/location", async (c) => {
    const phoneId = c.get("phone").id;
    const input = await body(
      c,
      z.object({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        accuracyM: z.number().min(0).max(100_000).optional(),
        recordedAt: z.iso.datetime({ offset: true }),
        purpose: z.string().regex(/^(always|find:\d+|checkin:[0-9a-f-]{36})$/i).optional(),
      }),
    );
    const now = ctx.now();
    const { purpose } = input;
    const recordedAt = new Date(input.recordedAt);
    const values = { lat: input.lat, lon: input.lon, accuracyM: input.accuracyM ?? null, recordedAt, receivedAt: now };
    const result = await ctx.db.transaction(async (tx) => {
      const [phone] = await tx.select().from(phones).where(eq(phones.id, phoneId)).for("no key update");
      if (!phone || phone.locationMode === "off") {
        return { status: 409, error: "location is off for this phone" } as const;
      }
      const requestedAt = phone.locateRequestedAt;
      const [checkin] = purpose === undefined || purpose.startsWith("checkin:")
        ? await tx.select().from(safetyRequests).where(and(
            eq(safetyRequests.phoneId, phone.id),
            eq(safetyRequests.kind, "checkin"),
          ))
        : [];
      const taggedFind = requestedAt !== null && purpose === `find:${requestedAt.getTime()}` &&
        now.getTime() - requestedAt.getTime() < FIND_WINDOW_MS;
      const { forFind, forCheckin, always, clearFind } = purpose === undefined
        ? legacyUntaggedTargets(phone, checkin, now, recordedAt)
        : {
            forFind: taggedFind,
            forCheckin: checkin !== undefined && purpose === `checkin:${checkin.id}` &&
              checkinLocationDue(checkin, phone.locationMode, now),
            always: purpose === "always" && phone.locationMode === "always" &&
              phone.locationAlwaysUntil !== null && phone.locationAlwaysUntil > now,
            clearFind: taggedFind && recordedAt >= requestedAt,
          };
      if (!always && !forFind && !forCheckin) return { status: 409 } as const;
      if (recordedAt.getTime() > now.getTime() + 5 * 60_000) {
        return { status: 400, error: "recordedAt is in the future" } as const;
      }
      if (purpose !== undefined && forCheckin && checkin && recordedAt <= checkin.createdAt) {
        return { status: 400, error: "recordedAt must be after check-in creation" } as const;
      }
      let staged = false;
      if (forCheckin && checkin && (purpose === undefined || recordedAt >= checkin.endsAt)) {
        // An answer or cancellation can still discard this fix before it becomes visible.
        const claimed = await tx
          .update(safetyRequests)
          .set({ pendingLocation: { ...values, recordedAt: recordedAt.toISOString(), receivedAt: now.toISOString() } })
          .where(and(
            eq(safetyRequests.id, checkin.id),
            isNull(safetyRequests.locatedAt),
            isNull(safetyRequests.pendingLocation),
            isNull(safetyRequests.answeredAt),
            isNull(safetyRequests.stoppedAt),
          ))
          .returning({ id: safetyRequests.id });
        staged = claimed.length > 0;
      }
      if (!always && !forFind && !staged) return { status: 409 } as const;
      if (clearFind && requestedAt !== null) {
        await tx
          .update(phones)
          .set({ locateRequestedAt: null })
          .where(and(eq(phones.id, phone.id), eq(phones.locateRequestedAt, requestedAt)));
      }
      if (always || forFind) await storeLatestLocation(tx, phone.id, values);
      return { status: 204 } as const;
    });
    if (result.status === 409) return c.json({ error: result.error ?? "no position was asked for" }, 409);
    if (result.status === 400) return c.json({ error: result.error }, 400);
    return c.body(null, 204);
  });

  // The phone reports what happened to a ring or an "Are you okay?" (docs/location.md).
  app.post("/safety/:rid", async (c) => {
    const phone = c.get("phone");
    const { event } = await body(c, z.object({ event: z.enum(["shown", "here", "ok", "call"]) }));
    const rid = z.uuid().safeParse(c.req.param("rid"));
    if (!rid.success) return c.json({ error: "not found" }, 404);
    const request = and(eq(safetyRequests.id, rid.data), eq(safetyRequests.phoneId, phone.id));
    const now = ctx.now();
    if (event === "shown") {
      const shown = await ctx.db
        .update(safetyRequests)
        .set({ shownAt: now })
        .where(and(request, isNull(safetyRequests.shownAt)))
        .returning({ id: safetyRequests.id });
      if (shown.length) return c.body(null, 204);
    } else {
      // Clear any unpublished fix in the same update that records the answer.
      const first = await ctx.db
        .update(safetyRequests)
        .set({ answeredAt: now, answer: event, pendingLocation: null, shownAt: sql`coalesce(${safetyRequests.shownAt}, ${now.toISOString()}::timestamptz)` })
        .where(and(request, eq(safetyRequests.kind, event === "here" ? "ring" : "checkin"), isNull(safetyRequests.answeredAt)))
        .returning({ stoppedAt: safetyRequests.stoppedAt });
      if (first.length) {
        if (!first[0]!.stoppedAt) await notifySafety(ctx, phone, event);
        return c.body(null, 204);
      }
    }
    const [req] = await ctx.db.select({ kind: safetyRequests.kind }).from(safetyRequests).where(request);
    if (!req) return c.json({ error: "not found" }, 404);
    if (event !== "shown" && (event === "here") !== (req.kind === "ring")) {
      return c.json({ error: `${event} does not answer a ${req.kind}` }, 400);
    }
    return c.body(null, 204);
  });

  app.put("/status", async (c) => {
    const phone = c.get("phone");
    const input = await body(
      c,
      z.object({
        appVersion: z.string().min(1).max(40),
        appVersionCode: z.number().int().positive().optional(),
        update: z.object({
          state: z.enum(["upToDate", "available", "installing", "prompted", "refused", "failed"]),
          errorCode: z.enum(UPDATE_ERROR_CODES).optional(),
          detail: z.string().max(200).nullable(),
          checkedAt: z.iso.datetime({ offset: true }).nullable(),
          latestVersion: z.string().max(40).nullable(),
        }).optional(),
        batteryPct: z.number().int().min(0).max(100).nullable(),
        charging: z.boolean().nullable(),
        deviceOwner: z.boolean(),
        lockIntact: z.boolean(),
        maintenance: z.boolean(),
        failedPolicies: z.array(z.string().min(1).max(200)).max(50),
        installOverrunSequence: z.number().int().positive().optional(),
        rulesEtag: z.string().max(100).nullable(),
        rulesAppliedAt: z.iso.datetime({ offset: true }).nullable(),
        dnsHost: z.string().max(253).nullable(),
        resetProtection: z.enum(["on", "off", "no-play-services", "failed"]).nullable().optional(),
        accountTypes: z.array(z.string().min(1).max(100)).max(20).nullable().optional(),
        callRoleActionNeeded: z.boolean().optional(),
        parallelAppsRemoved: z.boolean().optional(),
        parallelAppsRemovedId: z.uuid().optional(),
        lateGoogleAccountId: z.uuid().optional(),
        mode: z.enum(["strong", "light"]).optional(),
        protections: protections.optional(),
        timeUsed: z
          .record(limitTarget, z.number().int().min(0).max(1440))
          .refine((r) => Object.keys(r).length <= 200, "at most 200 entries")
          .optional(),
      }),
    );
    const appliedAt = input.rulesAppliedAt ? new Date(input.rulesAppliedAt) : null;
    if (appliedAt && appliedAt.getTime() > ctx.now().getTime() + 5 * 60_000) {
      return c.json({ error: "rulesAppliedAt is in the future" }, 400);
    }
    // A light-mode phone (paired as light, or reporting light) is only intact when all six
    // light protections are on, no policy failed and no maintenance unlock runs, whatever
    // it says about lockIntact. The server only ever makes this stricter.
    const p = input.protections;
    const light = phone.mode === "light" || input.mode === "light";
    const lockIntact =
      input.lockIntact &&
      (!light ||
        (p !== undefined &&
          LIGHT_LOCK.every((k) => p[k] === true) &&
          input.failedPolicies.length === 0 &&
          !input.maintenance));
    const { installOverrunSequence: sequence, parallelAppsRemoved, parallelAppsRemovedId,
      lateGoogleAccountId, ...reportedStatus } = input;
    const status = { ...reportedStatus, lockIntact, rulesAppliedAt: appliedAt?.toISOString() ?? null };
    const policy = input.failedPolicies.find(isInstallOverrun);
    const lost = await ctx.db.transaction(async (tx) => {
      // Serialize reports so retries keep the original expiry and only one report sees protection lost.
      const [prev] = await tx.select({
        status: phones.deviceStatus,
        attestation: phones.attestation,
        reportedAt: phones.statusReportedAt,
      }).from(phones).where(eq(phones.id, phone.id)).for("update");
      if (!prev) return null;
      const now = ctx.now();
      const previousOverrun = installOverrunFromStatus(prev.status, prev.reportedAt);
      const repeatedOverrun = policy && (sequence === undefined
        ? policy === previousOverrun?.policy && prev.status?.failedPolicies.includes(policy)
        : sequence === previousOverrun?.sequence);
      const installOverrun = policy && !repeatedOverrun
        ? { policy, sequence, receivedAt: now.toISOString() }
        : previousOverrun;
      const previousRemoval = parallelAppsRemovalFromStatus(prev.status, prev.reportedAt);
      const removalIsNew = parallelAppsRemovedId
        ? parallelAppsRemovedId !== previousRemoval?.id
        : parallelAppsRemoved && !previousRemoval;
      const parallelAppsRemovedNotice = removalIsNew
        ? { id: parallelAppsRemovedId, receivedAt: now.toISOString() }
        : previousRemoval;
      const previousLateAccount = prev.status?.lateGoogleAccountNotice;
      const lateGoogleAccountNotice = lateGoogleAccountId && lateGoogleAccountId !== previousLateAccount?.id
        ? { id: lateGoogleAccountId, receivedAt: now.toISOString() }
        : previousLateAccount;
      await tx.update(phones).set({
        deviceStatus: { ...status, installOverrun, parallelAppsRemovedNotice, lateGoogleAccountNotice },
        statusReportedAt: now,
      }).where(eq(phones.id, phone.id));
      return protectionLost(
        prev.status ? withAttestation(prev.status, prev.attestation) : null,
        withAttestation(status, prev.attestation),
      );
    });
    if (lost) {
      await notifyHousehold(ctx, phone.id, { type: "protection", phoneId: phone.id, phoneName: phone.name, reason: lost });
    }
    return c.body(null, 204);
  });

  // Requests from the person with the phone (spec 4 and 5). The phone shows the answers.
  app.post("/requests", async (c) => {
    const input = await body(
      c,
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("app"), packageName }),
        z.object({ kind: z.literal("contact"), name: z.string().trim().min(1).max(60), number: phoneNumber }),
      ]),
    );
    try {
      const { request, created } = await createRequest(ctx, c.get("phone"), input);
      return c.json(requestJson(request), created ? 201 : 200);
    } catch (err) {
      if (err instanceof RequestError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  });

  app.get("/requests", async (c) => c.json({ requests: await phoneRequestList(ctx, c.get("phone").id) }));

  app.put("/push-token", async (c) => {
    const input = await body(c, z.object({ fcmToken: z.string().min(1).max(4096).nullable() }));
    await ctx.db.update(phones).set({ fcmToken: input.fcmToken }).where(eq(phones.id, c.get("phone").id));
    return c.body(null, 204);
  });

  return app;
}
