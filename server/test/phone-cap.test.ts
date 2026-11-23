// SPDX-License-Identifier: Apache-2.0
//
// HOUSEHOLD_PHONE_CAP (docs/operations.md, "Phones per household"): adding a phone stops at the
// cap, phones already there keep working, and the per-user limits on pairing and setup hold
// across a restart because they are counted in the database.
import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { pairings, phones } from "../src/db/schema.js";
import { abuseCount } from "../src/services/abuse-metrics.js";
import { Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

const phoneCount = async () => (await h.ctx.db.select({ n: count() }).from(phones))[0]!.n;
const enroll = (parent: Client, name = "Alma") => parent.post("/api/phones/enroll", { name, profile: "child" });

async function startPairing() {
  const device = new Client(h);
  const start = await device.post("/api/device/pairings", { mode: "light", deviceInfo: { model: "Test" } });
  expect(start.status).toBe(201);
  return start.json.code as string;
}

describe("config", () => {
  it("is off unless set, also when Compose passes an empty value", () => {
    expect(loadConfig({ DATABASE_URL: "x" }).HOUSEHOLD_PHONE_CAP).toBe(0);
    expect(loadConfig({ DATABASE_URL: "x", HOUSEHOLD_PHONE_CAP: "" }).HOUSEHOLD_PHONE_CAP).toBe(0);
    expect(loadConfig({ DATABASE_URL: "x", HOUSEHOLD_PHONE_CAP: "10" }).HOUSEHOLD_PHONE_CAP).toBe(10);
    expect(() => loadConfig({ DATABASE_URL: "x", HOUSEHOLD_PHONE_CAP: "-1" })).toThrow();
  });
});

describe("household phone cap", () => {
  it("adds any number of phones while it is off", async () => {
    const parent = await signIn(h, "parent@example.org");
    for (let n = 0; n < 4; n++) expect((await enroll(parent, `Phone ${n}`)).status).toBe(201);
    await pairPhone(h, parent);
    expect(await phoneCount()).toBe(5);
  });

  it("stops a strong-mode setup at the cap and adds nothing", async () => {
    h.ctx.cfg.HOUSEHOLD_PHONE_CAP = 2;
    const parent = await signIn(h, "parent@example.org");
    expect((await enroll(parent, "One")).status).toBe(201);
    expect((await enroll(parent, "Two")).status).toBe(201);
    const before = abuseCount(h.ctx, "phone_cap");
    const third = await enroll(parent, "Three");
    expect(third.status).toBe(403);
    expect(third.json).toMatchObject({ code: "household_phone_cap", max: 2 });
    expect(await phoneCount()).toBe(2);
    expect(h.dns.clients.size).toBe(2);
    expect(abuseCount(h.ctx, "phone_cap")).toBe(before + 1);
  });

  it("stops a pairing at the cap, keeps the code open, and takes it once a phone is removed", async () => {
    h.ctx.cfg.HOUSEHOLD_PHONE_CAP = 1;
    const parent = await signIn(h, "parent@example.org");
    const first = await enroll(parent, "One");
    expect(first.status).toBe(201);
    const code = await startPairing();
    const refused = await parent.post("/api/phones/claim", { code, name: "Two", profile: "child" });
    expect(refused.status).toBe(403);
    expect(refused.json).toMatchObject({ code: "household_phone_cap", max: 1 });
    const [open] = await h.ctx.db.select().from(pairings);
    expect(open!.claimedAt).toBeNull();

    expect((await parent.call("DELETE", `/api/phones/${first.json.phone.id}`)).status).toBe(200);
    expect(await phoneCount()).toBe(0);
    expect((await parent.post("/api/phones/claim", { code, name: "Two", profile: "child" })).status).toBe(201);
  });

  it("counts per household, not per server", async () => {
    h.ctx.cfg.HOUSEHOLD_PHONE_CAP = 1;
    const a = await signIn(h, "a@example.org");
    const b = await signIn(h, "b@example.org");
    expect((await enroll(a)).status).toBe(201);
    expect((await enroll(b)).status).toBe(201);
    expect((await enroll(a)).status).toBe(403);
  });

  it("never touches phones that are already paired", async () => {
    const parent = await signIn(h, "parent@example.org");
    const one = await pairPhone(h, parent, { name: "One" });
    await pairPhone(h, parent, { name: "Two" });
    // The operator lowers the cap below what the family already has.
    h.ctx.cfg.HOUSEHOLD_PHONE_CAP = 1;
    expect((await one.device.get("/api/device/rules")).status).toBe(200);
    const rename = await parent.call("PATCH", `/api/phones/${one.phoneId}`, { name: "Uno" });
    expect(rename.status).toBe(200);
    expect(await phoneCount()).toBe(2);
    expect((await enroll(parent, "Three")).status).toBe(403);
  });

  it("lets two setups at the same instant take only the last place", async () => {
    h.ctx.cfg.HOUSEHOLD_PHONE_CAP = 1;
    const parent = await signIn(h, "parent@example.org");
    const results = await Promise.all([enroll(parent, "One"), enroll(parent, "Two"), enroll(parent, "Three")]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 403, 403]);
    expect(await phoneCount()).toBe(1);
  });
});

describe("per-user limits counted in the database", () => {
  it("keeps today's setup count across a restart", async () => {
    const parent = await signIn(h, "parent@example.org");
    for (let n = 0; n < 30; n++) expect((await enroll(parent, `P${n}`)).status).toBe(201);
    h.app = createApp(h.ctx);
    expect((await enroll(parent, "P30")).status).toBe(429);
  });

  it("keeps the pairing-code attempts across a restart", async () => {
    const parent = await signIn(h, "parent@example.org");
    for (let n = 0; n < 20; n++) {
      expect((await parent.post("/api/phones/pairing-profile", { code: "AAAA-BBBB" })).status).toBe(404);
    }
    h.app = createApp(h.ctx);
    expect((await parent.post("/api/phones/pairing-profile", { code: "AAAA-BBBB" })).status).toBe(429);
  });
});
