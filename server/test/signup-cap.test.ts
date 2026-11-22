// SPDX-License-Identifier: Apache-2.0
//
// SIGNUP_DAILY_CAP (#241): a daily cap on new households for the hosted service.
import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { households, selfKeys } from "../src/db/schema.js";
import { nextUtcMidnight, utcDayStart } from "../src/services/signup-cap.js";
import { Client, pairPhone, signIn, useHarness, type Harness } from "./harness.js";

const h = useHarness();

function setCap(cap: number) {
  h.ctx.cfg.SIGNUP_DAILY_CAP = cap;
}

async function request(email: string) {
  return new Client(h).post("/api/auth/request", { email, locale: "en" });
}

async function householdCount() {
  const [row] = await h.ctx.db.select({ n: count() }).from(households);
  return row!.n;
}

function lastToken(hh: Harness) {
  return decodeURIComponent(/#token=([^\s"&<]+)/.exec(hh.mail.outbox.at(-1)!.text)![1]!);
}

describe("config", () => {
  it("is off unless set, and empty means off", () => {
    expect(loadConfig({ DATABASE_URL: "x" }).SIGNUP_DAILY_CAP).toBe(0);
    expect(loadConfig({ DATABASE_URL: "x", SIGNUP_DAILY_CAP: "" }).SIGNUP_DAILY_CAP).toBe(0);
    expect(loadConfig({ DATABASE_URL: "x", SIGNUP_DAILY_CAP: "50" }).SIGNUP_DAILY_CAP).toBe(50);
    expect(() => loadConfig({ DATABASE_URL: "x", SIGNUP_DAILY_CAP: "-1" })).toThrow();
  });

  it("finds the UTC day around a moment", () => {
    const now = new Date("2026-11-16T23:59:59.999Z");
    expect(utcDayStart(now).toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(nextUtcMidnight(now).toISOString()).toBe("2026-11-17T00:00:00.000Z");
  });
});

describe("daily cap on new households", () => {
  beforeEach(() => setCap(2));

  it("does not limit anyone with the cap off", async () => {
    setCap(0);
    for (const n of [1, 2, 3, 4]) await signIn(h, `family${n}@example.org`);
    expect(await householdCount()).toBe(4);
  });

  it("lets the cap's worth of households in, then refuses the next without sending mail", async () => {
    await signIn(h, "one@example.org");
    await signIn(h, "two@example.org");
    const sent = h.mail.outbox.length;

    const r = await request("three@example.org");
    expect(r.status).toBe(429);
    expect(r.json.code).toBe("signup_cap_reached");
    expect(r.json.retryAt).toBe("2026-11-17T00:00:00.000Z");
    // 12:00 UTC to midnight.
    expect(r.headers.get("retry-after")).toBe(String(12 * 3600));
    expect(h.mail.outbox.length).toBe(sent);
    expect(await householdCount()).toBe(2);
  });

  it("holds a place for a link that was sent but not used yet", async () => {
    setCap(1);
    expect((await request("first@example.org")).status).toBe(202);
    const sent = h.mail.outbox.length;
    expect((await request("second@example.org")).status).toBe(429);
    expect(h.mail.outbox.length).toBe(sent);
    // The same person asking again is not a second household.
    expect((await request("first@example.org")).status).toBe(202);
  });

  it("frees the place again when an unused link expires", async () => {
    setCap(1);
    expect((await request("first@example.org")).status).toBe(202);
    h.clock.advance(16 * 60_000);
    expect((await request("second@example.org")).status).toBe(202);
  });

  it("never stops someone who already has an account", async () => {
    setCap(1);
    await signIn(h, "owner@example.org");
    expect((await request("new@example.org")).status).toBe(429);
    const again = await signIn(h, "owner@example.org");
    expect((await again.get("/api/me")).json.user.email).toBe("owner@example.org");
  });

  it("starts over at UTC midnight", async () => {
    setCap(1);
    h.clock.now = new Date("2026-11-16T23:50:00Z");
    await signIn(h, "late@example.org");
    h.clock.now = new Date("2026-11-16T23:59:59Z");
    const r = await request("early@example.org");
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("1");
    h.clock.now = new Date("2026-11-17T00:00:00Z");
    await signIn(h, "early@example.org");
    expect(await householdCount()).toBe(2);
  });

  it("lets an invited parent sign in and join while the cap is full", async () => {
    setCap(1);
    const owner = await signIn(h, "owner@example.org");
    const hid = (await owner.get("/api/me")).json.households[0].id as string;
    const invite = await owner.post(`/api/households/${hid}/invites`, { email: "partner@example.org" });
    expect(invite.status).toBe(201);
    const inviteToken = lastToken(h);

    expect((await request("stranger@example.org")).status).toBe(429);
    const partner = await signIn(h, "partner@example.org");
    expect((await partner.post("/api/invites/accept", { token: inviteToken })).json.householdId).toBe(hid);
  });

  it("lets a trusted person chosen by email sign in while the cap is full", async () => {
    setCap(1);
    const owner = await signIn(h, "self@example.org");
    const { phoneId } = await pairPhone(h, owner, { profile: "self" });
    await h.ctx.db
      .insert(selfKeys)
      .values({ phoneId, keyType: "trusted", trustedEmail: "friend@example.org" })
      .onConflictDoUpdate({ target: selfKeys.phoneId, set: { keyType: "trusted", trustedEmail: "friend@example.org" } });

    expect((await request("stranger@example.org")).status).toBe(429);
    await signIn(h, "friend@example.org");
    const [key] = await h.ctx.db.select().from(selfKeys).where(eq(selfKeys.phoneId, phoneId));
    expect(key!.trustedUserId).not.toBeNull();
  });

  it("refuses the household at sign-in if another process filled the cap first", async () => {
    setCap(1);
    expect((await request("racer@example.org")).status).toBe(202);
    const token = lastToken(h);
    // Another server process made a household meanwhile.
    await h.ctx.db.insert(households).values({ name: "Home", createdAt: h.clock.now });

    const c = new Client(h);
    const v = await c.post("/api/auth/verify", { token, client: "native" });
    expect(v.status).toBe(429);
    expect(v.json.code).toBe("signup_cap_reached");
    expect(await householdCount()).toBe(1);

    // The refused link stays unused: with room again the same day, the same token signs in.
    setCap(2);
    const again = await c.post("/api/auth/verify", { token, client: "native" });
    expect(again.status).toBe(200);
    expect(await householdCount()).toBe(2);
  });

  it("does not count an invited parent's own household against new families", async () => {
    const owner = await signIn(h, "owner@example.org");
    const hid = (await owner.get("/api/me")).json.households[0].id as string;
    expect((await owner.post(`/api/households/${hid}/invites`, { email: "partner@example.org" })).status).toBe(201);
    const inviteToken = lastToken(h);

    // A stranger gets a link while one place is free.
    expect((await request("stranger@example.org")).status).toBe(202);
    const strangerToken = lastToken(h);
    // The invited partner signs in (and gets a household of their own) before the stranger.
    const partner = await signIn(h, "partner@example.org");
    expect((await new Client(h).post("/api/auth/verify", { token: strangerToken })).status).toBe(200);
    expect(await householdCount()).toBe(3);

    // Still not counted once the invite is accepted (accepted invites are deleted).
    expect((await partner.post("/api/invites/accept", { token: inviteToken })).json.householdId).toBe(hid);
    expect((await request("third@example.org")).status).toBe(429);
  });

  it("does not let an invited parent's unused link hold a place", async () => {
    setCap(2);
    const owner = await signIn(h, "owner@example.org");
    const hid = (await owner.get("/api/me")).json.households[0].id as string;
    await owner.post(`/api/households/${hid}/invites`, { email: "partner@example.org" });
    expect((await request("partner@example.org")).status).toBe(202);
    expect((await request("stranger@example.org")).status).toBe(202);
  });

  it("does not count a trusted person's own household against new families", async () => {
    const owner = await signIn(h, "self@example.org");
    const { phoneId } = await pairPhone(h, owner, { profile: "self" });
    await h.ctx.db
      .insert(selfKeys)
      .values({ phoneId, keyType: "trusted", trustedEmail: "friend@example.org" })
      .onConflictDoUpdate({ target: selfKeys.phoneId, set: { keyType: "trusted", trustedEmail: "friend@example.org" } });
    await signIn(h, "friend@example.org");
    expect((await request("stranger@example.org")).status).toBe(202);
  });
});

describe("login links per address", () => {
  it("counts in the database, so a restart does not reset the limit", async () => {
    for (let i = 0; i < 5; i++) expect((await request("busy@example.org")).status).toBe(202);
    expect((await request("busy@example.org")).status).toBe(429);
    // A new app has fresh in-memory limiters, like a restarted or second process.
    h.app = createApp(h.ctx);
    expect((await request("busy@example.org")).status).toBe(429);
    expect(h.mail.outbox.length).toBe(5);
    // An hour later the address may ask again.
    h.clock.advance(61 * 60_000);
    expect((await request("busy@example.org")).status).toBe(202);
  });
});
