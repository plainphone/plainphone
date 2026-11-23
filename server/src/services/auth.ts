// SPDX-License-Identifier: Apache-2.0
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { householdMembers, households, magicLinks, selfKeys, sessions, users } from "../db/schema.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import type { Locale } from "../lib/locale.js";
import { loginMail } from "../lib/mail-templates.js";
import { MailUnavailableError } from "../providers/mail.js";
import type { Ctx } from "./context.js";
import { assertMailSlotFree, mailCapOn, takeMailSlot, warnMailCap } from "./mail-cap.js";
import { DEFAULT_HOUSEHOLD_NAME } from "./pairing-account.js";
import { assertHouseholdPlace, withSignupPlace } from "./signup-cap.js";

export const MAGIC_LINK_MINUTES = 15;
export const SESSION_DAYS = 60;
export const SESSION_PREFIX = "pp_s_";

/**
 * Sends a login link. Answers the same whether or not the address has an account,
 * so the endpoint cannot be used to find out who uses Plainphone.
 */
export async function requestMagicLink(
  ctx: Ctx,
  email: string,
  locale: Locale,
  client: "web" | "native" = "web",
): Promise<void> {
  const token = randomToken("pp_m_");
  // At the mail cap, answer "try again" before the link takes a sign-up place another address could use.
  if (ctx.mail.canSend) await assertMailSlotFree(ctx);
  const capped = ctx.mail.canSend && mailCapOn(ctx);
  const issue = async (tx: Ctx["db"] | Tx) => {
    // The mail's place under the mail cap is taken with the link (and its sign-up place) in one
    // transaction: when the last mail is gone, the link is rolled back and holds no sign-up place;
    // a refused sign-up or a failed insert takes no mail. Throws MailUnavailableError at the cap.
    if (capped) await takeMailSlot(ctx, false, tx);
    const now = ctx.now();
    await tx.insert(magicLinks).values({
      email,
      tokenHash: sha256(token),
      expiresAt: new Date(now.getTime() + MAGIC_LINK_MINUTES * 60_000),
      createdAt: now,
    });
  };
  try {
    // Throws SignupCapError (and sends nothing) when a new household would go over today's cap.
    // Without that cap there is no transaction of its own, so the mail cap opens one.
    await withSignupPlace(ctx, email, (db) => (capped && db === ctx.db ? ctx.db.transaction(issue) : issue(db)));
  } catch (err) {
    // The cap's warning is written now that the transaction no longer holds a connection.
    await warnMailCap(ctx, err);
    throw err;
  }
  // The link opens a page that POSTs the token, so mail scanners that follow
  // links cannot use it up. Native apps get /auth/app, which the app claims as a
  // universal/app link; without the app installed it opens the PWA like /auth/callback.
  const path = client === "native" ? "/auth/app" : "/auth/callback";
  const url = `${ctx.cfg.PUBLIC_URL}${path}#token=${encodeURIComponent(token)}`;
  if (!ctx.mail.canSend) {
    console.warn("login link requested, but no mail provider is configured (MAIL_PROVIDER=none)");
    return;
  }
  try {
    await ctx.mail.send(loginMail(email, locale, ctx.cfg.PUBLIC_URL, url, MAGIC_LINK_MINUTES), { slotTaken: true });
  } catch (err) {
    // Mail cap or a temporary refusal: the link never arrived, so it must not hold a sign-up
    // place or count towards the address's limit. The caller answers "try again".
    if (err instanceof MailUnavailableError) await ctx.db.delete(magicLinks).where(eq(magicLinks.tokenHash, sha256(token)));
    throw err;
  }
}

/**
 * Exchanges a magic-link token for a session. Creates the user and a household on first login.
 * Throws SignupCapError (the link stays unused) when that household would go over today's cap.
 */
export async function verifyMagicLink(ctx: Ctx, token: string, locale: string) {
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const [link] = await tx
      .update(magicLinks)
      .set({ usedAt: now })
      .where(and(eq(magicLinks.tokenHash, sha256(token)), isNull(magicLinks.usedAt), gt(magicLinks.expiresAt, now)))
      .returning();
    if (!link) return null;
    // A link sent before the cap filled holds its place; this only stops a race between processes.
    const out = await startSession(tx, link.email, locale, now, () => assertHouseholdPlace(ctx, tx, link.email, now));
    // Housekeeping: old links are useless.
    await tx.delete(magicLinks).where(lt(magicLinks.expiresAt, new Date(now.getTime() - 86_400_000)));
    return out;
  });
}

type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

/**
 * Opens a session for an address whose owner has proven it (a login link, or the review code in
 * services/review-login.ts). Creates the user and a household on first login.
 */
export async function startSession(
  tx: Tx,
  email: string,
  locale: string,
  now: Date,
  /** Runs before a new user and household are made, and throws to stop it (the signup cap). */
  beforeNewHousehold?: () => Promise<void>,
) {
  let [user] = await tx.select().from(users).where(eq(users.email, email));
  if (!user) {
    await beforeNewHousehold?.();
    // Two login links opened at once (two tabs): the loser of the insert uses the winner's user.
    [user] = await tx.insert(users).values({ email, locale }).onConflictDoNothing().returning();
    if (user) {
      const [household] = await tx.insert(households).values({ name: DEFAULT_HOUSEHOLD_NAME, summarySince: now, createdAt: now }).returning();
      await tx.insert(householdMembers).values({ householdId: household!.id, userId: user.id, role: "owner" });
    } else {
      [user] = await tx.select().from(users).where(eq(users.email, email));
    }
  }
  // A trusted person chosen by email before they had an account.
  await tx
    .update(selfKeys)
    .set({ trustedUserId: user!.id })
    .where(and(eq(selfKeys.trustedEmail, user!.email), isNull(selfKeys.trustedUserId)));

  const sessionToken = randomToken(SESSION_PREFIX);
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await tx.insert(sessions).values({ userId: user!.id, tokenHash: sha256(sessionToken), expiresAt });
  return { user: user!, sessionToken, expiresAt };
}

export async function resolveSession(ctx: Ctx, token: string) {
  if (!token.startsWith(SESSION_PREFIX)) return null;
  const [row] = await ctx.db
    .select({ user: users, id: sessions.id })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, ctx.now())));
  return row ?? null;
}

export async function endSession(ctx: Ctx, sessionId: string) {
  // Native push registrations reference this session with ON DELETE CASCADE.
  await ctx.db.delete(sessions).where(eq(sessions.id, sessionId));
}
