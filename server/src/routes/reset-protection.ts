// SPDX-License-Identifier: Apache-2.0
//
// "Protect against reset" (#20): Google sign-in for factory reset protection.
// Contract: server/openapi.yaml, tag "reset-protection".

import { and, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { householdMembers, type users } from "../db/schema.js";
import { clientIp, param, RateLimiter } from "../lib/http.js";
import type { Ctx } from "../services/context.js";
import {
  accountsSummary,
  googleAccountId,
  googleAuthUrl,
  PendingLogins,
  removeAccount,
  resetProtectionAvailable,
  saveAccount,
} from "../services/reset-protection.js";

type User = typeof users.$inferSelect;
type ParentEnv = { Variables: { user: User; viaCookie: boolean } };

export function resetProtectionRoutes(ctx: Ctx) {
  const pending = new PendingLogins();
  const startLimit = new RateLimiter(20, 60 * 60_000);
  const callbackLimit = new RateLimiter(60, 60 * 60_000);

  async function requireMember(c: Context<ParentEnv>) {
    const hid = param(c, "hid");
    const [m] = await ctx.db
      .select()
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, hid), eq(householdMembers.userId, c.get("user").id)));
    if (!m) throw new HTTPException(404, { message: "not found" });
    return hid;
  }

  /** Mounted inside the parent API, behind its session check. */
  function parent(app: Hono<ParentEnv>) {
    app.get("/households/:hid/reset-protection", async (c) => {
      const hid = await requireMember(c);
      return c.json({
        available: resetProtectionAvailable(ctx),
        accounts: await accountsSummary(ctx, hid, c.get("user").id),
      });
    });

    app.post("/households/:hid/reset-protection/google", async (c) => {
      const hid = await requireMember(c);
      if (!resetProtectionAvailable(ctx)) return c.json({ error: "Google sign-in is not set up on this server" }, 409);
      if (!startLimit.take(c.get("user").id)) throw new HTTPException(429, { message: "too many attempts" });
      const native = !c.get("viaCookie") && c.req.header("x-plainphone-app") === "parent";
      const { state, challenge } = pending.start(c.get("user").id, hid, ctx.now().getTime(), native);
      return c.json({ url: googleAuthUrl(ctx, state, challenge) });
    });

    app.delete("/households/:hid/reset-protection/mine", async (c) => {
      const hid = await requireMember(c);
      await removeAccount(ctx, hid, c.get("user").id);
      return c.body(null, 204);
    });
  }

  /** Google sends the browser back here. No session cookie arrives (SameSite=Strict); the state says who it is. */
  const callback = new Hono();
  callback.get("/google/callback", async (c) => {
    const allowed = callbackLimit.take(clientIp(c, ctx.cfg.TRUST_PROXY));
    const login = allowed ? pending.take(c.req.query("state") ?? "", ctx.now().getTime()) : null;
    const done = (result: "ok" | "cancelled" | "failed") =>
      c.redirect(`${login?.native ? "plainphone://" : `${ctx.cfg.PUBLIC_URL}/`}household?reset-protection=${result}`, 302);
    if (!login || !resetProtectionAvailable(ctx)) return done("failed");
    const code = c.req.query("code");
    if (!code) return done(c.req.query("error") === "access_denied" ? "cancelled" : "failed");
    // Still a member? The login may have started just before the parent was removed.
    const [m] = await ctx.db
      .select()
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, login.householdId), eq(householdMembers.userId, login.userId)));
    if (!m) return done("failed");
    try {
      const id = await googleAccountId(ctx, code, login.verifier);
      await saveAccount(ctx, login.householdId, login.userId, id);
    } catch (err) {
      console.error("reset protection sign-in failed", err instanceof Error ? err.name : "unknown error");
      return done("failed");
    }
    return done("ok");
  });

  return { parent, callback };
}
