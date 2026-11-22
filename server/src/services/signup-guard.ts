// SPDX-License-Identifier: Apache-2.0
//
// The checks on "mail me a sign-in link" (POST /api/auth/request) beyond the rate limits, in the
// order they run (docs/operations.md, "Bot and spam protection"):
//
// 1. Honeypot (SPAM_HONEYPOT): a hidden field a person never sees. Filled in, the request gets the
//    normal "check your mail" answer, but nothing is stored or sent.
// 2. Bot challenge (BOT_CHALLENGE=altcha): a solved ALTCHA puzzle, used once.
// 3. Throwaway mail (BLOCK_DISPOSABLE_EMAIL): only when the address would start a new household.

import type { Ctx } from "./context.js";
import { countAbuse } from "./abuse-metrics.js";
import { BOT_CHALLENGE_FAILED, BOT_CHALLENGE_REQUIRED, botChallengeOn, verifySolution } from "./bot-challenge.js";
import { DISPOSABLE_EMAIL_CODE, isDisposableEmail } from "./disposable-email.js";
import { hasAccount, isInvited } from "./signup-cap.js";

export type SignupGuard =
  | { kind: "ok" }
  /** Answer exactly like a success and send nothing. */
  | { kind: "silent" }
  | { kind: "refuse"; status: 403 | 422; body: { error: string; code: string } };

export function honeypotOn(ctx: Ctx): boolean {
  return ctx.cfg.SPAM_HONEYPOT === "on";
}

export async function guardSignupRequest(
  ctx: Ctx,
  input: { email: string; altcha?: string; website?: string },
): Promise<SignupGuard> {
  if (honeypotOn(ctx) && input.website?.trim()) {
    countAbuse(ctx, "honeypot");
    return { kind: "silent" };
  }
  if (botChallengeOn(ctx)) {
    if (!input.altcha) {
      countAbuse(ctx, "bot_challenge");
      return {
        kind: "refuse",
        status: 403,
        body: {
          error: "this server asks for a short security check first; if you use the app, update it",
          code: BOT_CHALLENGE_REQUIRED,
        },
      };
    }
    if (!(await verifySolution(ctx, input.altcha))) {
      countAbuse(ctx, "bot_challenge");
      return { kind: "refuse", status: 403, body: { error: "the security check did not pass; try again", code: BOT_CHALLENGE_FAILED } };
    }
  }
  if (ctx.cfg.BLOCK_DISPOSABLE_EMAIL === "on" && isDisposableEmail(input.email)) {
    // Existing accounts and invited people are never stopped: only a new household is refused.
    const known = (await hasAccount(ctx.db, input.email)) || (await isInvited(ctx.db, input.email, ctx.now()));
    if (!known) {
      countAbuse(ctx, "disposable_email");
      return {
        kind: "refuse",
        status: 422,
        body: { error: "throwaway mail addresses cannot start a new family; use an address you will keep", code: DISPOSABLE_EMAIL_CODE },
      };
    }
  }
  return { kind: "ok" };
}
