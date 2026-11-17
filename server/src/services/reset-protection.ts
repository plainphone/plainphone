// SPDX-License-Identifier: Apache-2.0
//
// Factory reset protection (FRP) from the dashboard (#20). A parent signs in with Google once;
// the server keeps only the numeric Google account ID (from the People API), never an email
// address, and sends it to the household's phones in the rules document. After a reset from
// recovery mode, Android's setup then asks for that Google account.

import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { frpAccounts, householdMembers, phones } from "../db/schema.js";
import type { Ctx } from "./context.js";
import { wakePhone } from "./phones.js";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_PEOPLE_URL = "https://people.googleapis.com/v1/people/me?personFields=metadata&sources=READ_SOURCE_TYPE_PROFILE&fields=resourceName";
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

/** Google: "Newly-created accounts might not be available for factory reset purposes for 72 hours". */
export const FRP_DELAY_MS = 72 * 60 * 60_000;
const STATE_TTL_MS = 10 * 60_000;
const MAX_PENDING = 1000;

export function resetProtectionAvailable(ctx: Ctx): boolean {
  return Boolean(ctx.cfg.GOOGLE_OAUTH_CLIENT_ID && ctx.cfg.GOOGLE_OAUTH_CLIENT_SECRET);
}

export function callbackUrl(ctx: Ctx): string {
  return `${ctx.cfg.PUBLIC_URL}/api/reset-protection/google/callback`;
}

interface PendingLogin {
  userId: string;
  householdId: string;
  verifier: string;
  native: boolean;
  expiresAt: number;
}

/**
 * Logins in progress, in memory: they live for ten minutes, and a restart only means the parent
 * presses the button again. The state is random and single-use; PKCE binds the code to it.
 */
export class PendingLogins {
  private readonly map = new Map<string, PendingLogin>();

  start(userId: string, householdId: string, now: number, native = false) {
    for (const [k, v] of this.map) if (v.expiresAt <= now) this.map.delete(k);
    if (this.map.size >= MAX_PENDING) throw new Error("too many logins in progress");
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    this.map.set(state, { userId, householdId, verifier, native, expiresAt: now + STATE_TTL_MS });
    return { state, challenge: createHash("sha256").update(verifier).digest("base64url") };
  }

  take(state: string, now: number): PendingLogin | null {
    const p = this.map.get(state);
    this.map.delete(state);
    return p && p.expiresAt > now ? p : null;
  }
}

/** The Google sign-in URL. The profile scope authorizes the People API without requesting email. */
export function googleAuthUrl(ctx: Ctx, state: string, challenge: string): string {
  const q = new URLSearchParams({
    client_id: ctx.cfg.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: callbackUrl(ctx),
    response_type: "code",
    scope: "openid https://www.googleapis.com/auth/userinfo.profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    // The parent must pick the account they will use after a reset, not whichever is signed in.
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH_URL}?${q}`;
}

/**
 * Exchanges the code and reads the numeric FRP account ID from the People API. The token comes straight from Google's
 * token endpoint over TLS, so its signature does not need checking (OpenID Connect Core 3.1.3.7);
 * issuer, audience and expiry are still checked.
 */
export async function googleAccountId(ctx: Ctx, code: string, verifier: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: ctx.cfg.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: ctx.cfg.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirect_uri: callbackUrl(ctx),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`Google token endpoint answered ${res.status}`);
  const token = (await res.json()) as { id_token?: unknown; access_token?: unknown };
  if (typeof token.id_token !== "string") throw new Error("no ID token from Google");
  const payload = decodeJwtPayload(token.id_token);
  if (!GOOGLE_ISSUERS.has(String(payload.iss))) throw new Error("ID token from the wrong issuer");
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(ctx.cfg.GOOGLE_OAUTH_CLIENT_ID)) throw new Error("ID token for another client");
  if (typeof payload.exp !== "number" || payload.exp * 1000 < ctx.now().getTime() - 60_000) {
    throw new Error("ID token expired");
  }
  if (typeof token.access_token !== "string") throw new Error("no access token from Google");
  const person = await fetch(GOOGLE_PEOPLE_URL, {
    headers: { authorization: `Bearer ${token.access_token}` },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!person.ok) throw new Error(`Google People API answered ${person.status}`);
  const { resourceName } = (await person.json()) as { resourceName?: unknown };
  const id = typeof resourceName === "string" ? /^people\/(\d{1,30})$/.exec(resourceName)?.[1] : undefined;
  if (!id) throw new Error("unexpected Google account ID format");
  return id;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1];
  if (!part) throw new Error("malformed ID token");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** Stores (or replaces) the user's account for the household and tells the phones. */
export async function saveAccount(ctx: Ctx, householdId: string, userId: string, googleAccountId: string) {
  await ctx.db
    .insert(frpAccounts)
    .values({ householdId, userId, googleAccountId, createdAt: ctx.now() })
    .onConflictDoUpdate({
      target: [frpAccounts.householdId, frpAccounts.userId],
      set: { googleAccountId, createdAt: ctx.now() },
    });
  await wakeHousehold(ctx, householdId);
}

export async function removeAccount(ctx: Ctx, householdId: string, userId: string) {
  await ctx.db.delete(frpAccounts).where(and(eq(frpAccounts.householdId, householdId), eq(frpAccounts.userId, userId)));
  await wakeHousehold(ctx, householdId);
}

async function wakeHousehold(ctx: Ctx, householdId: string) {
  const rows = await ctx.db.select({ id: phones.id }).from(phones).where(eq(phones.householdId, householdId));
  for (const r of rows) await wakePhone(ctx, r.id, "rules");
}

/**
 * Account IDs for the rules document: only of people who are still members of the household,
 * so a parent who leaves (or is removed) stops protecting the phones at the next sync.
 */
export async function householdAccountIds(ctx: Ctx, householdId: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: frpAccounts.googleAccountId })
    .from(frpAccounts)
    .innerJoin(
      householdMembers,
      and(eq(householdMembers.householdId, frpAccounts.householdId), eq(householdMembers.userId, frpAccounts.userId)),
    )
    .where(eq(frpAccounts.householdId, householdId));
  return [...new Set(rows.map((r) => r.id))].sort();
}

/** What the dashboard shows: who protects the phones, and from when. No account IDs leave the server. */
export async function accountsSummary(ctx: Ctx, householdId: string, me: string) {
  const rows = await ctx.db
    .select({ userId: frpAccounts.userId, createdAt: frpAccounts.createdAt })
    .from(frpAccounts)
    .innerJoin(
      householdMembers,
      and(eq(householdMembers.householdId, frpAccounts.householdId), eq(householdMembers.userId, frpAccounts.userId)),
    )
    .where(eq(frpAccounts.householdId, householdId))
    .orderBy(frpAccounts.createdAt);
  return rows.map((r) => ({
    mine: r.userId === me,
    userId: r.userId,
    addedAt: r.createdAt.toISOString(),
    // Conservative (the issue's rule): Google's 72-hour delay is about new accounts, counted here from linking.
    activeFrom: new Date(r.createdAt.getTime() + FRP_DELAY_MS).toISOString(),
  }));
}
