// SPDX-License-Identifier: Apache-2.0
//
// Bot and spam protection (docs/operations.md, "Bot and spam protection"): the ALTCHA challenge,
// the honeypot, throwaway addresses, the invitation cap per household and the database-backed
// rate limits, each with its off switch.
import { createHash } from "node:crypto";
import { count, eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { botChallengesSpent, householdInvites, inviteMails, magicLinks, rateLimitHits, serverSecrets } from "../src/db/schema.js";
import { abuseCount } from "../src/services/abuse-metrics.js";
import { CHALLENGE_MINUTES, sweepBotChallenges } from "../src/services/bot-challenge.js";
import { isDisposableEmail } from "../src/services/disposable-email.js";
import { sendInitialKeyInvite } from "../src/services/initial-self-key.js";
import { sweepInviteMails, takeInviteMail } from "../src/services/invite-cap.js";
import { addressKey, DbRateLimiter, sweepRateLimits } from "../src/services/rate-limits.js";
import { Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();
const MINUTE = 60_000;
const DAY = 86_400_000;

const anon = () => new Client(h);
const request = (body: Record<string, unknown>, ip?: string) =>
  anon().call("POST", "/api/auth/request", { locale: "en", ...body }, ip ? { "x-forwarded-for": ip } : {});

interface Challenge { algorithm: string; challenge: string; maxnumber: number; salt: string; signature: string }

/** A test-side solver, independent of the shared one the clients use. */
function solve(c: Challenge, number?: number): string {
  let n = number;
  for (let i = 0; n === undefined && i <= c.maxnumber; i++) {
    if (createHash("sha256").update(c.salt + i).digest("hex") === c.challenge) n = i;
  }
  return Buffer.from(JSON.stringify({ algorithm: c.algorithm, challenge: c.challenge, number: n, salt: c.salt, signature: c.signature })).toString("base64");
}

async function challenge(): Promise<Challenge> {
  const r = await anon().get("/api/auth/challenge");
  expect(r.status).toBe(200);
  return r.json;
}

async function rows(table: PgTable): Promise<number> {
  const [row] = await h.ctx.db.select({ n: count() }).from(table);
  return row!.n;
}

describe("config", () => {
  it("has calm self-hosting defaults", () => {
    const cfg = loadConfig({ DATABASE_URL: "x" });
    expect(cfg.BOT_CHALLENGE).toBe("off");
    expect(cfg.BOT_CHALLENGE_DIFFICULTY).toBe(100_000);
    expect(cfg.SPAM_HONEYPOT).toBe("on");
    expect(cfg.BLOCK_DISPOSABLE_EMAIL).toBe("on");
    expect(cfg.INVITES_PER_HOUSEHOLD_DAILY).toBe(20);
    // Compose passes unset variables as "".
    expect(loadConfig({ DATABASE_URL: "x", BOT_CHALLENGE: "", INVITES_PER_HOUSEHOLD_DAILY: "" }).INVITES_PER_HOUSEHOLD_DAILY).toBe(20);
  });

  it("reads the switches case-insensitively and keeps a misspelt challenge on", () => {
    expect(loadConfig({ DATABASE_URL: "x", BOT_CHALLENGE: "ALTCHA" }).BOT_CHALLENGE).toBe("altcha");
    expect(loadConfig({ DATABASE_URL: "x", SPAM_HONEYPOT: "Off" }).SPAM_HONEYPOT).toBe("off");
    const typo = loadConfig({ DATABASE_URL: "x", BOT_CHALLENGE: "altcah" });
    expect(typo.BOT_CHALLENGE).toBe("altcha");
    expect(typo.configWarnings.other).toContain("bot challenge: invalid BOT_CHALLENGE");
    expect(loadConfig({ DATABASE_URL: "x", BLOCK_DISPOSABLE_EMAIL: "maybe" }).BLOCK_DISPOSABLE_EMAIL).toBe("on");
  });

  it("drops a short HMAC key with a warning instead of stopping", () => {
    const cfg = loadConfig({ DATABASE_URL: "x", BOT_CHALLENGE_HMAC_KEY: "short" });
    expect(cfg.BOT_CHALLENGE_HMAC_KEY).toBeUndefined();
    expect(cfg.configWarnings.other).toContain("bot challenge: invalid BOT_CHALLENGE_HMAC_KEY");
    expect(() => loadConfig({ DATABASE_URL: "x", INVITES_PER_HOUSEHOLD_DAILY: "-1" })).toThrow();
  });
});

describe("bot challenge (ALTCHA)", () => {
  beforeEach(() => {
    h.ctx.cfg.BOT_CHALLENGE = "altcha";
    h.ctx.cfg.BOT_CHALLENGE_DIFFICULTY = 2_000;
  });

  it("is off by default: no challenge is handed out and none is asked for", async () => {
    h.ctx.cfg.BOT_CHALLENGE = "off";
    const r = await anon().get("/api/auth/challenge");
    expect(r.status).toBe(404);
    expect(r.json.code).toBe("bot_challenge_off");
    expect((await anon().get("/api/health")).json.botChallenge).toBe("off");
    expect((await request({ email: "family@example.org" })).status).toBe(202);
    expect(h.mail.outbox).toHaveLength(1);
  });

  it("tells clients through /api/health that a challenge is needed", async () => {
    expect((await anon().get("/api/health")).json).toMatchObject({ botChallenge: "altcha", honeypot: true });
  });

  it("refuses a request without a solution with a clear code, and sends nothing", async () => {
    const r = await request({ email: "family@example.org" });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("bot_challenge_required");
    // An old app shows the server's words: they must say what to do.
    expect(r.json.error).toMatch(/update/);
    expect(h.mail.outbox).toHaveLength(0);
    expect(await rows(magicLinks)).toBe(0);
  });

  it("accepts a solved challenge once, and sends the link", async () => {
    const c = await challenge();
    expect(c.maxnumber).toBe(2_000);
    expect(c.algorithm).toBe("SHA-256");
    const altcha = solve(c);
    expect((await request({ email: "family@example.org", altcha })).status).toBe(202);
    expect(h.mail.outbox).toHaveLength(1);
    // The same solution again, also for another address, is a replay.
    const again = await request({ email: "other@example.org", altcha });
    expect(again.status).toBe(403);
    expect(again.json.code).toBe("bot_challenge_failed");
    expect(h.mail.outbox).toHaveLength(1);
  });

  it("refuses a wrong number, a forged signature and a challenge from another key", async () => {
    const c = await challenge();
    const right = JSON.parse(Buffer.from(solve(c), "base64").toString()).number as number;
    const wrong = await request({ email: "family@example.org", altcha: solve(c, right + 1) });
    expect(wrong.json.code).toBe("bot_challenge_failed");
    const forged = solve({ ...c, signature: "0".repeat(64) });
    expect((await request({ email: "family@example.org", altcha: forged })).json.code).toBe("bot_challenge_failed");
    // A puzzle made with another key (another server, or a key that was changed) does not pass.
    h.ctx.cfg.BOT_CHALLENGE_HMAC_KEY = "k".repeat(32);
    const otherKey = solve(await challenge());
    h.ctx.cfg.BOT_CHALLENGE_HMAC_KEY = "j".repeat(32);
    expect((await request({ email: "family@example.org", altcha: otherKey })).json.code).toBe("bot_challenge_failed");
    expect((await request({ email: "family@example.org", altcha: "not base64 json" })).json.code).toBe("bot_challenge_failed");
    expect(h.mail.outbox).toHaveLength(0);
  });

  it("accepts a solution until the challenge expires, and not a second later", async () => {
    const early = solve(await challenge());
    const late = solve(await challenge());
    h.clock.advance(CHALLENGE_MINUTES * MINUTE - 1_000);
    expect((await request({ email: "one@example.org", altcha: early })).status).toBe(202);
    h.clock.advance(1_000);
    expect((await request({ email: "two@example.org", altcha: late })).json.code).toBe("bot_challenge_failed");
  });

  it("makes its own HMAC key once and keeps it in the database", async () => {
    h.ctx.cfg.BOT_CHALLENGE_HMAC_KEY = undefined;
    const c = await challenge();
    const keys = await h.ctx.db.select().from(serverSecrets).where(eq(serverSecrets.name, "bot-challenge-hmac"));
    expect(keys).toHaveLength(1);
    expect(keys[0]!.value.length).toBeGreaterThanOrEqual(43);
    // A restarted server (new app, same database) still accepts it.
    h.app = createApp(h.ctx);
    expect((await request({ email: "family@example.org", altcha: solve(c) })).status).toBe(202);
  });

  it("forgets spent solutions once their challenge has expired", async () => {
    await request({ email: "family@example.org", altcha: solve(await challenge()) });
    expect(await rows(botChallengesSpent)).toBe(1);
    expect(await sweepBotChallenges(h.ctx)).toBe(0);
    h.clock.advance(CHALLENGE_MINUTES * MINUTE + 1_000);
    expect(await sweepBotChallenges(h.ctx)).toBe(1);
    expect(await rows(botChallengesSpent)).toBe(0);
  });
});

describe("honeypot", () => {
  it("answers a filled-in hidden field like a success, sends nothing and counts it", async () => {
    const before = abuseCount(h.ctx, "honeypot");
    const r = await request({ email: "bot@example.org", website: "https://spam.example" });
    expect(r.status).toBe(202);
    expect(r.json).toEqual({ ok: true, mailEnabled: true });
    expect(h.mail.outbox).toHaveLength(0);
    expect(await rows(magicLinks)).toBe(0);
    expect(abuseCount(h.ctx, "honeypot")).toBe(before + 1);
  });

  it("lets an empty or blank field through", async () => {
    expect((await request({ email: "one@example.org", website: "" })).status).toBe(202);
    expect((await request({ email: "two@example.org", website: "  " })).status).toBe(202);
    expect(h.mail.outbox).toHaveLength(2);
  });

  it("is ignored when SPAM_HONEYPOT is off", async () => {
    h.ctx.cfg.SPAM_HONEYPOT = "off";
    expect((await anon().get("/api/health")).json.honeypot).toBe(false);
    expect((await request({ email: "family@example.org", website: "filled" })).status).toBe(202);
    expect(h.mail.outbox).toHaveLength(1);
  });

  it("answers before the bot challenge, so a bot learns nothing from it", async () => {
    h.ctx.cfg.BOT_CHALLENGE = "altcha";
    const r = await request({ email: "bot@example.org", website: "filled" });
    expect(r.status).toBe(202);
    expect(h.mail.outbox).toHaveLength(0);
  });
});

describe("throwaway mail addresses", () => {
  it("knows the vendored list, its subdomains and the allow list", () => {
    expect(isDisposableEmail("someone@mailinator.com")).toBe(true);
    expect(isDisposableEmail("someone@MAILINATOR.com")).toBe(true);
    expect(isDisposableEmail("someone@inbox.mailinator.com")).toBe(true);
    expect(isDisposableEmail("someone@mailinator.com.example.org")).toBe(false);
    expect(isDisposableEmail("someone@example.org")).toBe(false);
    expect(isDisposableEmail("someone@gmail.com")).toBe(false);
    expect(isDisposableEmail("someone@duck.com")).toBe(false);
  });

  it("refuses a new household with a throwaway address, calmly and without mail", async () => {
    const before = abuseCount(h.ctx, "disposable_email");
    const r = await request({ email: "new@mailinator.com" });
    expect(r.status).toBe(422);
    expect(r.json.code).toBe("disposable_email");
    expect(h.mail.outbox).toHaveLength(0);
    expect(abuseCount(h.ctx, "disposable_email")).toBe(before + 1);
  });

  it("never stops an existing account or an invited parent", async () => {
    h.ctx.cfg.BLOCK_DISPOSABLE_EMAIL = "off";
    await signIn(h, "old@mailinator.com");
    const mum = await signIn(h, "mum@example.org");
    h.ctx.cfg.BLOCK_DISPOSABLE_EMAIL = "on";
    expect((await request({ email: "old@mailinator.com" })).status).toBe(202);
    const hid = (await mum.get("/api/me")).json.households[0].id as string;
    expect((await mum.post(`/api/households/${hid}/invites`, { email: "dad@mailinator.com" })).status).toBe(201);
    expect((await request({ email: "dad@mailinator.com" })).status).toBe(202);
    expect((await request({ email: "stranger@mailinator.com" })).status).toBe(422);
  });

  it("lets everyone in when BLOCK_DISPOSABLE_EMAIL is off", async () => {
    h.ctx.cfg.BLOCK_DISPOSABLE_EMAIL = "off";
    expect((await request({ email: "new@mailinator.com" })).status).toBe(202);
    expect(h.mail.outbox).toHaveLength(1);
  });
});

describe("invitation mails per household", () => {
  async function household() {
    const mum = await signIn(h, "mum@example.org");
    const hid = (await mum.get("/api/me")).json.households[0].id as string;
    const invite = (n: number) => mum.post(`/api/households/${hid}/invites`, { email: `guest${n}@example.org` });
    return { mum, hid, invite };
  }

  it("sends the cap's worth in 24 hours, then refuses without storing or sending", async () => {
    h.ctx.cfg.INVITES_PER_HOUSEHOLD_DAILY = 3;
    const { hid, invite } = await household();
    const sent = h.mail.outbox.length;
    for (const n of [1, 2, 3]) expect((await invite(n)).status).toBe(201);
    const over = await invite(4);
    expect(over.status).toBe(429);
    expect(over.json.code).toBe("invite_cap_reached");
    expect(h.mail.outbox.length).toBe(sent + 3);
    const stored = await h.ctx.db.select().from(householdInvites).where(eq(householdInvites.householdId, hid));
    expect(stored).toHaveLength(3);
  });

  it("frees a place exactly 24 hours after a mail, not before", async () => {
    h.ctx.cfg.INVITES_PER_HOUSEHOLD_DAILY = 1;
    const { invite } = await household();
    expect((await invite(1)).status).toBe(201);
    h.clock.advance(DAY - 1);
    expect((await invite(2)).status).toBe(429);
    h.clock.advance(1);
    expect((await invite(3)).status).toBe(201);
  });

  it("counts each household on its own", async () => {
    h.ctx.cfg.INVITES_PER_HOUSEHOLD_DAILY = 1;
    const { invite } = await household();
    expect((await invite(1)).status).toBe(201);
    const dad = await signIn(h, "dad@example.org");
    const other = (await dad.get("/api/me")).json.households[0].id as string;
    expect((await dad.post(`/api/households/${other}/invites`, { email: "gran@example.org" })).status).toBe(201);
  });

  it("is off with 0", async () => {
    h.ctx.cfg.INVITES_PER_HOUSEHOLD_DAILY = 0;
    const { invite } = await household();
    for (const n of [1, 2, 3, 4, 5, 6]) expect((await invite(n)).status).toBe(201);
    expect(await rows(inviteMails)).toBe(0);
  });

  it("also covers the trusted person's mail at setup, which is skipped while the key is kept", async () => {
    h.ctx.cfg.INVITES_PER_HOUSEHOLD_DAILY = 2;
    const { mum, hid } = await household();
    const { phoneId } = await pairPhone(h, mum, { profile: "self" });
    const sent = h.mail.outbox.length;
    const key = { keyType: "trusted" as const, trustedEmail: "helper@example.org" };
    await sendInitialKeyInvite(h.ctx, key, null, phoneId);
    expect(h.mail.outbox.length).toBe(sent + 1);
    expect(await takeInviteMail(h.ctx, hid)).toBe(true);
    await sendInitialKeyInvite(h.ctx, key, null, phoneId);
    expect(h.mail.outbox.length).toBe(sent + 1);
    // The parent invitation shares the count.
    expect((await mum.post(`/api/households/${hid}/invites`, { email: "dad@example.org" })).json.code).toBe("invite_cap_reached");
  });

  it("forgets mails older than a day", async () => {
    const { hid } = await household();
    await takeInviteMail(h.ctx, hid);
    h.clock.advance(DAY - 1);
    expect(await sweepInviteMails(h.ctx)).toBe(0);
    h.clock.advance(2);
    expect(await sweepInviteMails(h.ctx)).toBe(1);
  });
});

describe("rate limits in the database", () => {
  beforeEach(() => {
    h.ctx.cfg.TRUST_PROXY = true;
  });

  it("names a client by its IPv4 address or its IPv6 /64", () => {
    expect(addressKey("192.0.2.7")).toBe("192.0.2.7");
    expect(addressKey("::ffff:192.0.2.7")).toBe("192.0.2.7");
    expect(addressKey("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
    expect(addressKey("2001:0db8:0001:0002::9")).toBe("2001:db8:1:2::/64");
    expect(addressKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(addressKey("2001:db8:1:3::1")).not.toBe(addressKey("2001:db8:1:2::1"));
  });

  it("counts to the limit exactly, per window, shared by every process", async () => {
    const one = new DbRateLimiter("test", 2, 15 * MINUTE);
    const two = new DbRateLimiter("test", 2, 15 * MINUTE);
    expect(await one.takeIp(h.ctx, "192.0.2.1")).toBe(true);
    expect(await two.takeIp(h.ctx, "192.0.2.1")).toBe(true);
    expect(await one.takeIp(h.ctx, "192.0.2.1")).toBe(false);
    expect(await one.takeIp(h.ctx, "192.0.2.2")).toBe(true);
    // The harness clock is 12:00, the start of a 15-minute window.
    h.clock.advance(15 * MINUTE - 1);
    expect(await two.takeIp(h.ctx, "192.0.2.1")).toBe(false);
    h.clock.advance(1);
    expect(await two.takeIp(h.ctx, "192.0.2.1")).toBe(true);
  });

  it("stores a keyed hash that changes every day, never the address", async () => {
    const limit = new DbRateLimiter("test", 5, 60 * MINUTE);
    await limit.takeIp(h.ctx, "192.0.2.55");
    h.clock.advance(DAY);
    await limit.takeIp(h.ctx, "192.0.2.55");
    const stored = await h.ctx.db.select().from(rateLimitHits);
    expect(stored).toHaveLength(2);
    for (const row of stored) expect(JSON.stringify(row)).not.toContain("192.0.2.55");
    expect(stored[0]!.subject).not.toBe(stored[1]!.subject);
  });

  it("limits sign-in requests per address across a restart", async () => {
    for (let n = 0; n < 20; n++) expect((await request({ email: `p${n}@example.org` }, "198.51.100.4")).status).toBe(202);
    expect((await request({ email: "p20@example.org" }, "198.51.100.4")).status).toBe(429);
    h.app = createApp(h.ctx);
    expect((await request({ email: "p21@example.org" }, "198.51.100.4")).status).toBe(429);
    expect((await request({ email: "p22@example.org" }, "198.51.100.5")).status).toBe(202);
  });

  it("limits pairing starts per address in the database", async () => {
    const start = () => anon().call("POST", "/api/device/pairings", { mode: "light" }, { "x-forwarded-for": "203.0.113.9" });
    for (let n = 0; n < 10; n++) expect((await start()).status).toBe(201);
    h.app = createApp(h.ctx);
    expect((await start()).status).toBe(429);
  });

  it("deletes rows whose window has ended", async () => {
    const limit = new DbRateLimiter("test", 5, 15 * MINUTE);
    await limit.takeIp(h.ctx, "192.0.2.1");
    expect(await sweepRateLimits(h.ctx)).toBe(0);
    h.clock.advance(15 * MINUTE + 1);
    expect(await sweepRateLimits(h.ctx)).toBe(1);
  });
});

describe("metrics", () => {
  it("shows how often each protection stepped in, by reason only", async () => {
    h.ctx.cfg.METRICS_TOKEN = "t".repeat(32);
    await request({ email: "bot@example.org", website: "filled" });
    const r = await anon().get("/api/metrics", { authorization: `Bearer ${"t".repeat(32)}` });
    const text = r.json as string;
    expect(text).toMatch(new RegExp(`plainphone_abuse_blocked_total\\{reason="honeypot"\\} ${abuseCount(h.ctx, "honeypot")}`));
    expect(abuseCount(h.ctx, "honeypot")).toBeGreaterThan(0);
    expect(text).toContain('plainphone_abuse_blocked_total{reason="invite_cap"}');
    expect(text).not.toContain("bot@example.org");
  });
});
