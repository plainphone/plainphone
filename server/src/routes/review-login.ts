// SPDX-License-Identifier: Apache-2.0
//
// POST /api/auth/review: sign-in with the review code (docs/store-review.md). Mounted before the
// parent API's session check. Without REVIEW_LOGIN_EMAIL and REVIEW_LOGIN_CODE it answers 404,
// like any path that does not exist.
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { body, clientIp, RateLimiter } from "../lib/http.js";
import { errorSummary } from "../lib/log.js";
import * as v from "../lib/validation.js";
import { SESSION_DAYS, startSession } from "../services/auth.js";
import type { Ctx } from "../services/context.js";
import { ensureReviewDemo, type LocalRequest } from "../services/review-demo.js";
import { reviewCodeMatches, reviewLoginEnabled } from "../services/review-login.js";
import { SESSION_COOKIE } from "./parent.js";

export function reviewLoginRoutes(ctx: Ctx, request: LocalRequest) {
  const app = new Hono();
  const secureCookie = ctx.cfg.PUBLIC_URL.startsWith("https://");
  // The code is long enough that guessing is hopeless; the limits keep the log readable and stop
  // a script from spending the server's time. The global one is generous so a reviewer is never
  // locked out by someone else's attempts for long.
  const ipLimit = new RateLimiter(10, 15 * 60_000);
  const allLimit = new RateLimiter(100, 60 * 60_000);

  app.post("/auth/review", async (c) => {
    if (!reviewLoginEnabled(ctx.cfg)) return c.json({ error: "not found" }, 404);
    if (!ipLimit.take(clientIp(c, ctx.cfg.TRUST_PROXY)) || !allLimit.take("all")) {
      console.warn("review sign-in: rate limited");
      throw new HTTPException(429, { message: "too many attempts; try again later" });
    }
    const input = await body(
      c,
      z.object({
        email: v.email,
        code: z.string().max(200),
        locale: v.locale.default("en"),
        client: z.enum(["web", "native"]).default("web"),
      }),
    );
    // One answer for a wrong address and a wrong code, so neither can be found on its own.
    if (!reviewCodeMatches(ctx.cfg, input.email, input.code.trim())) {
      console.warn("review sign-in: refused");
      return c.json({ error: "wrong address or code" }, 401);
    }
    const out = await ctx.db.transaction((tx) => startSession(tx, input.email, input.locale, ctx.now()));
    console.info("review sign-in: signed in");
    try {
      await ensureReviewDemo(ctx, request, out.user.id, out.sessionToken);
    } catch (err) {
      // The sign-in itself worked; the reviewer can still look around.
      console.error(`review sign-in: demo phone failed: ${errorSummary(err)}`);
    }
    setCookie(c, SESSION_COOKIE, out.sessionToken, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: "Strict",
      path: "/api",
      maxAge: SESSION_DAYS * 86_400,
    });
    return c.json({
      user: { id: out.user.id, email: out.user.email, locale: out.user.locale },
      ...(input.client === "native" ? { sessionToken: out.sessionToken } : {}),
    });
  });

  return app;
}
