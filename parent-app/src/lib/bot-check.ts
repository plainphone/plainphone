// SPDX-License-Identifier: Apache-2.0
//
// The sign-in bot check (docs/operations.md, "Bot and spam protection"). When the server asks for
// it, the app fetches an ALTCHA puzzle and solves it in JavaScript, with no webview, in small
// slices so the screen stays responsive. Each answer is used for one request.

import { solveAltcha, type AltchaChallenge } from "@plainphone/shared/altcha";
import { client, unwrap } from "../api/client";

/** Smaller slices than the dashboard's: Hermes runs the hash loop without a JIT. */
const SLICE = 1_000;

export async function solveBotCheck(signal?: AbortSignal): Promise<string> {
  const challenge = await unwrap<AltchaChallenge>(client.GET("/auth/challenge"));
  return solveAltcha(challenge, { slice: SLICE, signal });
}

export const BOT_CHALLENGE_CODES = ["bot_challenge_required", "bot_challenge_failed"];

/** The puzzle could not be fetched or solved. */
export class BotCheckFailed extends Error {
  constructor() {
    super("bot check failed");
  }
}
