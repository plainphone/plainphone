// SPDX-License-Identifier: Apache-2.0
//
// Store review sign-in (docs/store-review.md): one address, one code, nothing else.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { users } from "../src/db/schema.js";
import { reviewCodeMatches } from "../src/services/review-login.js";
import { Client, pairPhone, PUBLIC_URL, signIn, useHarness } from "./harness.js";

const h = useHarness();
const EMAIL = "review@example.test";
const CODE = "demo-review-code-0123456789abcdefghijkl";

function enable(env: Record<string, string> = { REVIEW_LOGIN_EMAIL: "Review@Example.test ", REVIEW_LOGIN_CODE: CODE }) {
  h.ctx.cfg = loadConfig({ DATABASE_URL: "unused", PUBLIC_URL, NODE_ENV: "test", ...env });
  h.app = createApp(h.ctx);
}

async function reviewSignIn(body: Record<string, unknown>) {
  const c = new Client(h);
  const r = await c.post("/api/auth/review", { client: "native", ...body });
  if (r.status === 200) c.token = r.json.sessionToken;
  return { c, r };
}

describe("review sign-in switched off", () => {
  it("does not exist without both settings", async () => {
    const { r } = await reviewSignIn({ email: EMAIL, code: CODE });
    expect(r.status).toBe(404);
    const req = await new Client(h).post("/api/auth/request", { email: EMAIL });
    expect(req.status).toBe(202);
    expect(req.json.codeSignIn).toBeUndefined();
    expect(h.mail.outbox).toHaveLength(1);
  });

  it.each([
    ["only an address", { REVIEW_LOGIN_EMAIL: EMAIL }],
    ["only a code", { REVIEW_LOGIN_CODE: CODE }],
    ["a short code", { REVIEW_LOGIN_EMAIL: EMAIL, REVIEW_LOGIN_CODE: "x".repeat(31) }],
    ["an invalid address", { REVIEW_LOGIN_EMAIL: "not an address", REVIEW_LOGIN_CODE: CODE }],
  ] as [string, Record<string, string>][])("stays off with %s, reported without the values", async (_, env) => {
    enable(env);
    expect(h.ctx.cfg.REVIEW_LOGIN_EMAIL).toBeUndefined();
    expect(h.ctx.cfg.REVIEW_LOGIN_CODE).toBeUndefined();
    const warning = h.ctx.cfg.configWarnings.other.find((w) => w.startsWith("review:"));
    expect(warning).toBeDefined();
    expect(warning).not.toContain(CODE);
    expect(warning).not.toContain(EMAIL);
    const { r } = await reviewSignIn({ email: EMAIL, code: env.REVIEW_LOGIN_CODE ?? CODE });
    expect(r.status).toBe(404);
  });

  it("never matches without settings", () => {
    expect(reviewCodeMatches({ REVIEW_LOGIN_EMAIL: undefined, REVIEW_LOGIN_CODE: undefined }, EMAIL, CODE)).toBe(false);
  });
});

describe("review sign-in switched on", () => {
  beforeEach(() => enable());

  it("offers the code only for the review address, and sends it no mail", async () => {
    const review = await new Client(h).post("/api/auth/request", { email: "REVIEW@example.test" });
    expect(review.status).toBe(202);
    expect(review.json.codeSignIn).toBe(true);
    expect(h.mail.outbox).toHaveLength(0);
    const other = await new Client(h).post("/api/auth/request", { email: "parent@example.test" });
    expect(other.json.codeSignIn).toBeUndefined();
    expect(h.mail.outbox).toHaveLength(1);
  });

  it("signs the review address in with the code, in the app and on the web", async () => {
    const { c, r } = await reviewSignIn({ email: " Review@example.TEST", code: CODE });
    expect(r.status).toBe(200);
    expect(r.json.user.email).toBe(EMAIL);
    expect(r.json.sessionToken).toMatch(/^pp_s_/);
    const me = await c.get("/api/me");
    expect(me.status).toBe(200);
    expect(me.json.households).toHaveLength(1);

    const web = await new Client(h).post("/api/auth/review", { email: EMAIL, code: CODE });
    expect(web.status).toBe(200);
    expect(web.json.sessionToken).toBeUndefined();
    expect(web.headers.get("set-cookie")).toMatch(/pp_session=pp_s_.*HttpOnly/);
  });

  it("never accepts the code for another address", async () => {
    const { r } = await reviewSignIn({ email: "someone@example.test", code: CODE });
    expect(r.status).toBe(401);
    expect(await h.ctx.db.select().from(users).where(eq(users.email, "someone@example.test"))).toHaveLength(0);
    // Not even an address that already has an account.
    await signIn(h, "parent@example.test");
    expect((await reviewSignIn({ email: "parent@example.test", code: CODE })).r.status).toBe(401);
  });

  it("refuses a wrong or missing code with the same answer as a wrong address", async () => {
    const wrong = await reviewSignIn({ email: EMAIL, code: `${CODE}x` });
    const empty = await reviewSignIn({ email: EMAIL, code: "" });
    const other = await reviewSignIn({ email: "someone@example.test", code: CODE });
    expect(wrong.r.status).toBe(401);
    expect(empty.r.status).toBe(401);
    expect(wrong.r.json).toEqual(other.r.json);
    expect(await h.ctx.db.select().from(users).where(eq(users.email, EMAIL))).toHaveLength(0);
  });

  it("is rate limited", async () => {
    for (let i = 0; i < 10; i++) expect((await reviewSignIn({ email: EMAIL, code: "wrong" })).r.status).toBe(401);
    const limited = await reviewSignIn({ email: EMAIL, code: CODE });
    expect(limited.r.status).toBe(429);
  });

  it("logs each attempt without the address or the code", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      await reviewSignIn({ email: EMAIL, code: "wrong-code" });
      await reviewSignIn({ email: EMAIL, code: CODE });
      const lines = [...warn.mock.calls, ...info.mock.calls].map((args) => args.join(" "));
      expect(lines).toContain("review sign-in: refused");
      expect(lines).toContain("review sign-in: signed in");
      for (const line of lines) {
        expect(line).not.toContain(CODE);
        expect(line).not.toContain("wrong-code");
        expect(line).not.toContain(EMAIL);
      }
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  });

  it("gives the review household a demo phone that looks alive", async () => {
    const { c } = await reviewSignIn({ email: EMAIL, code: CODE });
    const phones = await c.get("/api/phones");
    expect(phones.json.phones).toHaveLength(1);
    const phone = phones.json.phones[0];
    expect(phone.name).toBe("Alex");
    expect(phone.profile).toBe("child");
    expect(phone.lastSeenAt).toBe(h.clock.now.toISOString());
    expect(phone.status.lockIntact).toBe(true);

    const apps = await c.get(`/api/phones/${phone.id}/apps`);
    expect(apps.json.apps.length).toBeGreaterThan(5);
    const requests = await c.get(`/api/phones/${phone.id}/requests`);
    expect(requests.json.requests).toEqual([expect.objectContaining({ kind: "app", status: "pending" })]);
    const contacts = await c.get(`/api/phones/${phone.id}/contacts`);
    expect(contacts.json.contacts).toHaveLength(2);
    const location = await c.get(`/api/phones/${phone.id}/location`);
    expect(location.json.location).toMatchObject({ lat: 55.6857, lon: 12.5776 });

    // A later sign-in checks the same phone in again instead of adding another.
    h.clock.advance(3 * 86_400_000);
    await reviewSignIn({ email: EMAIL, code: CODE });
    const again = await c.get("/api/phones");
    expect(again.json.phones).toHaveLength(1);
    expect(again.json.phones[0].id).toBe(phone.id);
    expect(again.json.phones[0].lastSeenAt).toBe(h.clock.now.toISOString());
  });

  it("makes a new demo phone when the reviewer removed it", async () => {
    const { c } = await reviewSignIn({ email: EMAIL, code: CODE });
    const [phone] = (await c.get("/api/phones")).json.phones;
    expect((await c.del(`/api/phones/${phone.id}`)).status).toBeLessThan(300);
    await reviewSignIn({ email: EMAIL, code: CODE });
    const after = (await c.get("/api/phones")).json.phones;
    expect(after).toHaveLength(1);
    expect(after[0].id).not.toBe(phone.id);
  });

  it("leaves a household with a real phone alone", async () => {
    const { c } = await reviewSignIn({ email: EMAIL, code: CODE });
    const [demo] = (await c.get("/api/phones")).json.phones;
    await c.del(`/api/phones/${demo.id}`);
    await pairPhone(h, c, { name: "Real" });
    await reviewSignIn({ email: EMAIL, code: CODE });
    const phones = (await c.get("/api/phones")).json.phones;
    expect(phones.map((p: { name: string }) => p.name)).toEqual(["Real"]);
  });
});
