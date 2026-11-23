// SPDX-License-Identifier: Apache-2.0
//
// MAIL_HOURLY_CAP and MAIL_DAILY_CAP (#240): an overall cap on outgoing mail, and a clear
// "try again" when the cap is reached or the mail server refuses for now (SMTP 4xx).
import { randomUUID } from "node:crypto";
import { count, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db/client.js";
import { magicLinks } from "../src/db/schema.js";
import { MailUnavailableError, SmtpMailProvider, smtpError, type Mail } from "../src/providers/mail.js";
import { CappedMailProvider, mailMetricsText, mailsCounted } from "../src/services/mail-cap.js";
import type { Ctx } from "../src/services/context.js";
import { createTestDatabase } from "./db.js";
import { Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

function setCaps(hourly: number, daily = 0) {
  h.ctx.cfg.MAIL_HOURLY_CAP = hourly;
  h.ctx.cfg.MAIL_DAILY_CAP = daily;
}

const request = (email: string) => new Client(h).post("/api/auth/request", { email, locale: "en" });
const other: Mail = { to: "someone@example.org", subject: "Alert", html: "<p>x</p>", text: "x" };

async function links() {
  const [row] = await h.ctx.db.select({ n: count() }).from(magicLinks);
  return row!.n;
}

afterEach(() => vi.restoreAllMocks());

describe("config", () => {
  it("is off unless set, and empty means off", () => {
    const off = loadConfig({ DATABASE_URL: "x", MAIL_HOURLY_CAP: "", MAIL_DAILY_CAP: "" });
    expect([off.MAIL_HOURLY_CAP, off.MAIL_DAILY_CAP]).toEqual([0, 0]);
    const on = loadConfig({ DATABASE_URL: "x", MAIL_HOURLY_CAP: "40", MAIL_DAILY_CAP: "400" });
    expect([on.MAIL_HOURLY_CAP, on.MAIL_DAILY_CAP]).toEqual([40, 400]);
    expect(() => loadConfig({ DATABASE_URL: "x", MAIL_HOURLY_CAP: "-1" })).toThrow();
  });
});

describe("overall mail cap", () => {
  it("counts nothing and stops nothing with the caps off", async () => {
    for (const n of [1, 2, 3, 4]) await h.ctx.mail.send(other);
    expect(h.mail.outbox).toHaveLength(4);
    setCaps(1);
    expect(await mailsCounted(h.ctx)).toEqual({ hour: 0, day: 0 });
  });

  it("counts every kind of mail towards one cap", async () => {
    setCaps(3);
    await signIn(h, "parent@example.org"); // a sign-in link
    const parent = await signIn(h, "parent@example.org");
    const [hh] = (await parent.get("/api/me")).json.households;
    const invite = await parent.post(`/api/households/${hh.id}/invites`, { email: "second@example.org" });
    expect(invite.json.mailed).toBe(true);
    expect(await mailsCounted(h.ctx)).toEqual({ hour: 3, day: 3 });

    // The cap is used: an alert is refused, and nothing more is counted.
    await expect(h.ctx.mail.send(other)).rejects.toBeInstanceOf(MailUnavailableError);
    expect(h.mail.outbox).toHaveLength(3);
    expect(await mailsCounted(h.ctx)).toEqual({ hour: 3, day: 3 });
  });

  it("answers a sign-in at the cap with mail_unavailable, sends nothing and keeps no link", async () => {
    setCaps(1);
    await h.ctx.mail.send(other);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const r = await request("new@example.org");
    expect(r.status).toBe(503);
    expect(r.json.code).toBe("mail_unavailable");
    expect(r.json.retryAt).toBe("2026-11-16T13:00:00.000Z");
    expect(r.headers.get("retry-after")).toBe(String(60 * 60));
    expect(h.mail.outbox).toHaveLength(1);
    // The link that was never mailed holds no place and does not count towards the address's limit.
    expect(await links()).toBe(0);

    // One warning line per hour, without addresses.
    await request("again@example.org");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("MAIL_HOURLY_CAP=1");
    expect(String(warn.mock.calls[0]![0])).not.toContain("@");
  });

  it("writes the warning once per hour across replicas", async () => {
    setCaps(1);
    await h.ctx.mail.send(other);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A second process (or this one after a restart) shares the database, not the memory.
    const replica = new CappedMailProvider({ ...h.ctx }, h.mail);
    await expect(h.ctx.mail.send(other)).rejects.toBeInstanceOf(MailUnavailableError);
    await expect(replica.send(other)).rejects.toBeInstanceOf(MailUnavailableError);
    expect(warn).toHaveBeenCalledTimes(1);

    h.clock.advance(60 * 60_000);
    setCaps(0, 1);
    await expect(replica.send(other)).rejects.toBeInstanceOf(MailUnavailableError);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("refuses sign-in at the cap before a link holds a sign-up place", async () => {
    h.ctx.cfg.SIGNUP_DAILY_CAP = 1;
    setCaps(1);
    await h.ctx.mail.send(other);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Neither link can be mailed, so neither may keep the other out with "come back tomorrow".
    const answers = await Promise.all([request("first@example.org"), request("second@example.org")]);
    expect(answers.map((r) => r.json.code)).toEqual(["mail_unavailable", "mail_unavailable"]);
    expect(await links()).toBe(0);
  });

  it("keeps the mail slot and the sign-up place together when sign-ins race for the last mails", async () => {
    // Three sign-up places, two mails left: no new address may be told "come back tomorrow"
    // because a link that then could not be mailed held a place.
    h.ctx.cfg.SIGNUP_DAILY_CAP = 3;
    setCaps(3);
    await h.ctx.mail.send(other);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const answers = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => request(`new${n}@example.org`)));
    const codes = answers.map((r) => (r.status === 202 ? "sent" : r.json.code)).sort();
    expect(codes).toEqual(["mail_unavailable", "mail_unavailable", "mail_unavailable", "mail_unavailable", "sent", "sent"]);
    expect(h.mail.outbox).toHaveLength(3);
    expect(await links()).toBe(2);
    expect(await mailsCounted(h.ctx)).toEqual({ hour: 3, day: 3 });
  });

  it.each([0, 5])("answers the loser of a race for the last mail with a pool of one (SIGNUP_DAILY_CAP=%i)", async (signupCap) => {
    // The cap's warning row must not wait for a connection the sign-in's own transaction holds.
    const copy = await createTestDatabase();
    const small = createDb(copy.url, 1);
    try {
      const ctx: Ctx = { ...h.ctx, db: small.db, cfg: { ...h.ctx.cfg, SIGNUP_DAILY_CAP: signupCap, MAIL_HOURLY_CAP: 1 } };
      const app = createApp(ctx);
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const post = (email: string) =>
        app.request("/api/auth/request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, locale: "en" }),
        });
      const answers = await Promise.all([post("first@example.org"), post("second@example.org")]);
      expect(answers.map((r) => r.status).sort()).toEqual([202, 503]);
      expect(h.mail.outbox).toHaveLength(1);
    } finally {
      await small.sql.end();
      await copy.drop();
    }
  });

  it("gives the mail back when the link cannot be stored, also without a sign-up cap", async () => {
    setCaps(1);
    vi.spyOn(console, "error").mockImplementation(() => {});
    // A link insert that fails for this address only.
    await h.ctx.db.execute(sql`alter table magic_links add constraint test_no_link check (email <> 'broken@example.org')`);
    try {
      expect((await request("broken@example.org")).status).toBe(500);
    } finally {
      await h.ctx.db.execute(sql`alter table magic_links drop constraint test_no_link`);
    }
    expect(await mailsCounted(h.ctx)).toEqual({ hour: 0, day: 0 });
    expect((await request("new@example.org")).status).toBe(202);
  });

  it("still answers mail_unavailable when the cap warning cannot be written", async () => {
    setCaps(1);
    await h.ctx.mail.send(other);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // Only the warning row fails; the sign-in's other writes (the per-IP limit) go through.
    const insert = h.ctx.db.insert.bind(h.ctx.db);
    vi.spyOn(h.ctx.db, "insert").mockImplementation(((table: Parameters<typeof insert>[0]) => {
      const query = insert(table);
      const values = query.values.bind(query);
      query.values = ((row: { bucket?: string }) => {
        if (row.bucket === "mail-cap-warned") throw Object.assign(new Error("connection lost"), { code: "08006" });
        return values(row as never);
      }) as typeof query.values;
      return query;
    }) as typeof insert);

    const r = await request("new@example.org");
    expect(r.status).toBe(503);
    expect(r.json.code).toBe("mail_unavailable");
    // The failed write is logged without addresses, and the warning still shows once.
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain("08006");
    expect(error.mock.calls.flat().join(" ")).not.toContain("@");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("MAIL_HOURLY_CAP=1");
  });

  it("starts over at the next UTC hour, and the daily cap at the next UTC day", async () => {
    setCaps(2, 3);
    await h.ctx.mail.send(other);
    await h.ctx.mail.send(other);
    await expect(h.ctx.mail.send(other)).rejects.toMatchObject({ retryAt: new Date("2026-11-16T13:00:00Z") });

    h.clock.advance(60 * 60_000); // 13:00 UTC: a new hour, the same day
    await h.ctx.mail.send(other);
    expect(await mailsCounted(h.ctx)).toEqual({ hour: 1, day: 3 });
    await expect(h.ctx.mail.send(other)).rejects.toMatchObject({ reason: "cap", retryAt: new Date("2026-11-17T00:00:00Z") });

    h.clock.advance(11 * 60 * 60_000); // 00:00 UTC the next day
    await h.ctx.mail.send(other);
    expect(await mailsCounted(h.ctx)).toEqual({ hour: 1, day: 1 });
    expect(h.mail.outbox).toHaveLength(4);
  });

  it("still sends an SOS at the cap, and counts it", async () => {
    setCaps(1);
    await h.ctx.mail.send(other);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(h.ctx.mail.send(other)).rejects.toBeInstanceOf(MailUnavailableError);
    await h.ctx.mail.send({ ...other, subject: "SOS" }, { urgent: true });
    expect(h.mail.outbox.map((m) => m.subject)).toEqual(["Alert", "SOS"]);
    expect(await mailsCounted(h.ctx)).toEqual({ hour: 2, day: 2 });
  });

  it("still mails the parents an SOS from the phone at the cap, and counts it", async () => {
    // Through the SOS service, so the test fails if it stops marking its mail urgent.
    const parent = await signIn(h, "parent@example.org");
    const { device } = await pairPhone(h, parent, { profile: "child" });
    setCaps(1);
    await h.ctx.mail.send(other);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = h.mail.outbox.length;

    expect((await device.post("/api/device/sos", { id: randomUUID(), kind: "urgent" })).status).toBe(200);
    await vi.waitFor(() => expect(h.mail.outbox.slice(before).map((m) => m.to)).toEqual(["parent@example.org"]));
    expect(await mailsCounted(h.ctx)).toEqual({ hour: 2, day: 2 });
  });

  it("keeps an invitation at the cap and hands the inviter the link instead", async () => {
    const parent = await signIn(h, "parent@example.org");
    const [hh] = (await parent.get("/api/me")).json.households;
    setCaps(1);
    await h.ctx.mail.send(other);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const invite = await parent.post(`/api/households/${hh.id}/invites`, { email: "second@example.org" });
    expect(invite.status).toBe(201);
    expect(invite.json.mailed).toBe(false);
    expect(invite.json.url).toMatch(/\/invite#token=/);
  });

  it("shows the counts and the caps on the metrics page", async () => {
    setCaps(5, 50);
    await h.ctx.mail.send(other);
    const text = await mailMetricsText(h.ctx);
    expect(text).toContain('plainphone_mail_counted{window="hour"} 1');
    expect(text).toContain('plainphone_mail_cap{window="day"} 50');
    expect(text).toMatch(/plainphone_mail_total\{outcome="sent"\} \d+/);
  });
});

describe("temporary refusals by the mail server", () => {
  it("maps SMTP 4xx to MailUnavailableError with the code only, and leaves 5xx alone", () => {
    for (const code of [421, 450, 451, 452]) {
      const err = smtpError(Object.assign(new Error("452 4.5.3 too many recipients <someone@example.org>"), { responseCode: code }));
      expect(err).toBeInstanceOf(MailUnavailableError);
      expect((err as MailUnavailableError).smtpCode).toBe(code);
      expect((err as Error).message).not.toContain("@");
    }
    const hard = Object.assign(new Error("550 no such user"), { responseCode: 550 });
    expect(smtpError(hard)).toBe(hard);
    const network = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    expect(smtpError(network)).toBe(network);
  });

  it("answers a sign-in with mail_unavailable instead of a 500, and logs the code only", async () => {
    // A real SMTP provider whose server answers 451, so the mapping in SmtpMailProvider.send is covered.
    const smtp = new SmtpMailProvider("smtp://localhost:2525", "noreply@example.org");
    const transport = (smtp as unknown as { transport: { sendMail: () => Promise<unknown> } }).transport;
    vi.spyOn(transport, "sendMail").mockRejectedValue(
      Object.assign(new Error("451 4.7.1 slow down <new@example.org>"), { responseCode: 451 }),
    );
    h.ctx.mail = new CappedMailProvider(h.ctx, smtp);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await request("new@example.org");
    expect(r.status).toBe(503);
    expect(r.json.code).toBe("mail_unavailable");
    expect(r.headers.get("retry-after")).toBe("300");
    expect(await links()).toBe(0);
    expect(warn).toHaveBeenCalledWith("mail server refused for now (SMTP 451)");
    expect(error).not.toHaveBeenCalled();
  });

  it("keeps a permanent refusal (5xx) an error", async () => {
    vi.spyOn(h.mail, "send").mockRejectedValue(Object.assign(new Error("550 rejected"), { responseCode: 550 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await request("new@example.org")).status).toBe(500);
  });
});
