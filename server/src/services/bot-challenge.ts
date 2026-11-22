// SPDX-License-Identifier: Apache-2.0
//
// ALTCHA proof of work (https://altcha.org, protocol v1), done without a third party, cookies or
// tracking. The server hands out a random salt and the SHA-256 of salt + a secret number up to
// `maxnumber`; the client finds the number by trying them all, which costs a person a second or
// two once and a bot that same work for every mail it wants sent. The HMAC signature lets the
// server check a solution without storing the challenge, and each solution is accepted once.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lt } from "drizzle-orm";
import { z } from "zod";
import { botChallengesSpent } from "../db/schema.js";
import type { Ctx } from "./context.js";
import { serverSecret } from "./server-secrets.js";

/** How long a challenge can be solved and used. */
export const CHALLENGE_MINUTES = 10;

export const BOT_CHALLENGE_REQUIRED = "bot_challenge_required";
export const BOT_CHALLENGE_FAILED = "bot_challenge_failed";

export interface Challenge {
  algorithm: "SHA-256";
  challenge: string;
  maxnumber: number;
  salt: string;
  signature: string;
}

export function botChallengeOn(ctx: Ctx): boolean {
  return ctx.cfg.BOT_CHALLENGE === "altcha";
}

async function hmacKey(ctx: Ctx): Promise<string> {
  return ctx.cfg.BOT_CHALLENGE_HMAC_KEY ?? serverSecret(ctx, "bot-challenge-hmac");
}

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

export async function createChallenge(ctx: Ctx): Promise<Challenge> {
  const expires = Math.floor(ctx.now().getTime() / 1000) + CHALLENGE_MINUTES * 60;
  // The expiry is part of the salt, so the signature covers it (as ALTCHA does). The closing "&"
  // keeps the salt from being lengthened: without it, the first digits of the number could be
  // moved onto the expiry, giving the same hash with a later date.
  const salt = `${randomBytes(12).toString("hex")}?expires=${expires}&`;
  const maxnumber = ctx.cfg.BOT_CHALLENGE_DIFFICULTY;
  // Uniform over 0..maxnumber: on average a client tries half of them.
  const number = randomBytes(4).readUInt32BE() % (maxnumber + 1);
  const challenge = sha256Hex(salt + number);
  const signature = createHmac("sha256", await hmacKey(ctx)).update(challenge).digest("hex");
  return { algorithm: "SHA-256", challenge, maxnumber, salt, signature };
}

/** The exact shape createChallenge makes; anything else was not made here. */
const SALT = /^[0-9a-f]{24}\?expires=(\d{1,12})&$/;

const payload = z.strictObject({
  algorithm: z.literal("SHA-256"),
  challenge: z.string().regex(/^[0-9a-f]{64}$/),
  number: z.number().int().min(0).max(10_000_000),
  salt: z.string().regex(SALT),
  signature: z.string().regex(/^[0-9a-f]{64}$/),
  /** The widget may add how long solving took; it is ignored. */
  took: z.number().optional(),
});

function decode(raw: string): z.infer<typeof payload> | null {
  try {
    const parsed = payload.safeParse(JSON.parse(Buffer.from(raw, "base64").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function equalHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * True when `raw` is a solution of a challenge this server made, not expired and not used before.
 * A true answer uses the solution up, so the caller must call this only once per request.
 */
export async function verifySolution(ctx: Ctx, raw: string | undefined): Promise<boolean> {
  if (!raw || raw.length > 2000) return false;
  const p = decode(raw);
  if (!p) return false;
  const expires = Number(SALT.exec(p.salt)![1]) * 1000;
  const now = ctx.now().getTime();
  // Never later than a fresh challenge expires, so a spent row is always swept in time.
  if (expires <= now || expires > now + CHALLENGE_MINUTES * 60_000) return false;
  if (!equalHex(sha256Hex(p.salt + p.number), p.challenge)) return false;
  const expected = createHmac("sha256", await hmacKey(ctx)).update(p.challenge).digest("hex");
  if (!equalHex(expected, p.signature)) return false;
  // Replay protection: the first request with this signature stores it, any later one finds it.
  const spent = await ctx.db
    .insert(botChallengesSpent)
    .values({ signature: p.signature, expiresAt: new Date(expires) })
    .onConflictDoNothing()
    .returning({ signature: botChallengesSpent.signature });
  return spent.length === 1;
}

/** Sweeper: spent solutions whose challenge has expired cannot be replayed anyway. */
export async function sweepBotChallenges(ctx: Ctx): Promise<number> {
  const rows = await ctx.db.delete(botChallengesSpent).where(lt(botChallengesSpent.expiresAt, ctx.now()));
  return rows.count;
}
