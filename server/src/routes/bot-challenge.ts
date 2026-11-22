// SPDX-License-Identifier: Apache-2.0
//
// GET /api/auth/challenge: a fresh ALTCHA puzzle for the sign-in form (docs/operations.md, "Bot and
// spam protection"). Public, no cookies, nothing stored: the signature lets the server check the
// solution later. Answers 404 while BOT_CHALLENGE is off, as /api/health also says.

import { Hono } from "hono";
import { clientIp, RateLimiter } from "../lib/http.js";
import { botChallengeOn, createChallenge } from "../services/bot-challenge.js";
import type { Ctx } from "../services/context.js";

export function botChallengeRoutes(ctx: Ctx) {
  const app = new Hono();
  // Making a puzzle costs the server one HMAC; the limit only stops a flood.
  const limit = new RateLimiter(120, 60 * 60_000);

  app.get("/auth/challenge", async (c) => {
    if (!botChallengeOn(ctx)) return c.json({ error: "this server asks for no security check", code: "bot_challenge_off" }, 404);
    if (!limit.take(clientIp(c, ctx.cfg.TRUST_PROXY))) return c.json({ error: "slow down" }, 429);
    c.header("Cache-Control", "no-store");
    return c.json(await createChallenge(ctx));
  });

  return app;
}
