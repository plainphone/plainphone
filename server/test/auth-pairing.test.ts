// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { Client, PUBLIC_URL, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

describe("accounts", () => {
  it("signs in with a magic link, once, and creates a household", async () => {
    const c = new Client(h);
    expect((await c.post("/api/auth/request", { email: "Parent@Example.org", locale: "da" })).status).toBe(202);
    const mail = h.mail.outbox[0]!;
    expect(mail.to).toBe("parent@example.org");
    expect(mail.subject).toBe("Dit login til Plainphone");
    expect(mail.html).toContain(`${PUBLIC_URL}/mail/logo@2x.png`);
    expect(mail.text).toContain(`${PUBLIC_URL}/auth/callback#token=`);
    const token = decodeURIComponent(/#token=(\S+)/.exec(mail.text)![1]!);

    const v = await c.post("/api/auth/verify", { token });
    expect(v.status).toBe(200);
    const cookie = v.headers.get("set-cookie")!;
    expect(cookie).toMatch(/pp_session=.*HttpOnly.*Secure.*SameSite=Strict/i);
    // The PWA never sees the token in JavaScript; only native apps ask for it.
    expect(v.json.sessionToken).toBeUndefined();
    expect((await c.post("/api/auth/verify", { token })).status).toBe(400); // single use

    c.token = /pp_session=([^;]+)/.exec(cookie)![1];
    const me = await c.get("/api/me");
    expect(me.json.user.email).toBe("parent@example.org");
    expect(me.json.households).toHaveLength(1);
    expect(me.json.households[0].role).toBe("owner");
  });

  it("rejects expired links", async () => {
    const c = new Client(h);
    await c.post("/api/auth/request", { email: "late@example.org" });
    const token = decodeURIComponent(/#token=(\S+)/.exec(h.mail.outbox[0]!.text)![1]!);
    h.clock.advance(16 * 60_000);
    expect((await c.post("/api/auth/verify", { token })).status).toBe(400);
  });

  it("needs a session for the parent API and logs out", async () => {
    const anon = new Client(h);
    expect((await anon.get("/api/phones")).status).toBe(401);
    const c = await signIn(h, "a@example.org");
    expect((await c.get("/api/phones")).status).toBe(200);
    expect((await c.post("/api/auth/logout")).status).toBe(204);
    expect((await c.get("/api/phones")).status).toBe(401);
  });

  it("refuses cross-site writes made with the session cookie", async () => {
    const c = await signIn(h, "a@example.org");
    const cookie = `pp_session=${c.token}`;
    const bare = new Client(h);
    const evil = await bare.call("PATCH", "/api/me", { locale: "da" }, { cookie, origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    const ok = await bare.call("PATCH", "/api/me", { locale: "da" }, { cookie, origin: PUBLIC_URL });
    expect(ok.status).toBe(204);
    expect((await bare.call("GET", "/api/me", undefined, { cookie })).status).toBe(200);
  });

  it("sends nothing without a mail provider and says so", async () => {
    const { NoMailProvider } = await import("../src/providers/mail.js");
    h.ctx.mail = new NoMailProvider();
    const { createApp } = await import("../src/app.js");
    h.app = createApp(h.ctx);
    const r = await new Client(h).post("/api/auth/request", { email: "x@example.org" });
    expect(r.status).toBe(202);
    expect(r.json.mailEnabled).toBe(false);
  });

  it("invites a second parent who then sees the same phones", async () => {
    const mum = await signIn(h, "mum@example.org");
    const hid = (await mum.get("/api/me")).json.households[0].id;
    const { phoneId } = await pairPhone(h, mum);

    const inv = await mum.post(`/api/households/${hid}/invites`, { email: "dad@example.org" });
    expect(inv.status).toBe(201);
    const inviteMail = h.mail.outbox.at(-1)!;
    expect(inviteMail.to).toBe("dad@example.org");
    const token = decodeURIComponent(/invite#token=(\S+)/.exec(inviteMail.text)![1]!);

    const dad = await signIn(h, "dad@example.org");
    expect((await dad.get(`/api/phones/${phoneId}`)).status).toBe(404);
    expect((await dad.post("/api/invites/accept", { token })).status).toBe(200);
    expect((await dad.post("/api/invites/accept", { token })).status).toBe(400);
    expect((await dad.get(`/api/phones/${phoneId}`)).status).toBe(200);
    const members = await mum.get(`/api/households/${hid}/members`);
    expect(members.json.members.map((m: any) => m.email).sort()).toEqual(["dad@example.org", "mum@example.org"]);
  });
});

describe("pairing", () => {
  it("pairs a phone by code and hands out the device token exactly once", async () => {
    const parent = await signIn(h, "p@example.org");
    const device = new Client(h);
    const start = await device.post("/api/device/pairings", { mode: "strong" });
    expect(start.status).toBe(201);
    expect(start.json.code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect(start.json.qrUrl).toBe(`${PUBLIC_URL}/pair?code=${encodeURIComponent(start.json.code)}`);
    const poll = (secret = start.json.pollSecret) =>
      device.get(`/api/device/pairings/${start.json.pairingId}`, { "x-poll-secret": secret });

    expect((await poll()).status).toBe(202);
    expect((await poll("wrong")).status).toBe(404);

    // Typed in lower case with a space: still matches.
    const typed = start.json.code.toLowerCase().replace("-", " ");
    const claim = await parent.post("/api/phones/claim", { code: typed, name: "Alma", profile: "child" });
    expect(claim.status).toBe(201);
    expect(claim.json.dnsHost).toMatch(/^[a-z2-7]{20}\.dns\.plainphone\.org$/);

    const got = await poll();
    expect(got.status).toBe(200);
    expect(got.json.deviceToken).toMatch(/^pp_d_/);
    expect((await poll()).status).toBe(410);
    expect((await parent.post("/api/phones/claim", { code: typed, name: "Again", profile: "child" })).status).toBe(404);

    device.token = got.json.deviceToken;
    expect((await device.get("/api/device/rules")).status).toBe(200);
    // A device token cannot use the parent API.
    expect((await device.get("/api/phones")).status).toBe(403);
    // The phone was registered with the DNS service with every category blocked.
    const dnsClient = h.dns.clients.get(claim.json.dnsHost.split(".")[0])!;
    expect(dnsClient.profile).toBe("child");
    expect(dnsClient.blockedCategories).toHaveLength(6);
  });

  it("never shows a claimed pairing as expired to the polling phone", async () => {
    const parent = await signIn(h, "p@example.org");
    const device = new Client(h);
    const start = await device.post("/api/device/pairings", {});
    const poll = () =>
      device.get(`/api/device/pairings/${start.json.pairingId}`, { "x-poll-secret": start.json.pollSecret });
    const [claim, first] = await Promise.all([
      parent.post("/api/phones/claim", { code: start.json.code, name: "A", profile: "child" }),
      poll(),
    ]);
    expect(claim.status).toBe(201);
    expect([200, 202]).toContain(first.status);
    if (first.status === 202) expect((await poll()).status).toBe(200);
  });

  it("limits invitations per recipient", async () => {
    const a = await signIn(h, "a@example.org");
    const hid = (await a.get("/api/me")).json.households[0].id;
    for (let i = 0; i < 3; i++) {
      expect((await a.post(`/api/households/${hid}/invites`, { email: "x@example.org" })).status).toBe(201);
    }
    expect((await a.post(`/api/households/${hid}/invites`, { email: "x@example.org" })).status).toBe(429);
  });

  it("keeps an owner when the owner leaves", async () => {
    const mum = await signIn(h, "mum@example.org");
    const hid = (await mum.get("/api/me")).json.households[0].id;
    await mum.post(`/api/households/${hid}/invites`, { email: "dad@example.org" });
    const token = decodeURIComponent(/invite#token=(\S+)/.exec(h.mail.outbox.at(-1)!.text)![1]!);
    const dad = await signIn(h, "dad@example.org");
    await dad.post("/api/invites/accept", { token });
    const mumId = (await mum.get("/api/me")).json.user.id;
    expect((await mum.del(`/api/households/${hid}/members/${mumId}`)).status).toBe(204);
    const members = await dad.get(`/api/households/${hid}/members`);
    expect(members.json.members).toEqual([expect.objectContaining({ email: "dad@example.org", role: "owner" })]);
  });

  it("expires codes after 15 minutes", async () => {
    const parent = await signIn(h, "p@example.org");
    const device = new Client(h);
    const start = await device.post("/api/device/pairings", {});
    h.clock.advance(16 * 60_000);
    expect(
      (await parent.post("/api/phones/claim", { code: start.json.code, name: "A", profile: "child" })).status,
    ).toBe(404);
    const poll = await device.get(`/api/device/pairings/${start.json.pairingId}`, {
      "x-poll-secret": start.json.pollSecret,
    });
    expect(poll.status).toBe(410);
  });

  it("keeps households apart", async () => {
    const a = await signIn(h, "a@example.org");
    const b = await signIn(h, "b@example.org");
    const { phoneId } = await pairPhone(h, a);
    expect((await b.get(`/api/phones/${phoneId}`)).status).toBe(404);
    expect((await b.get(`/api/phones/${phoneId}/contacts`)).status).toBe(404);
    expect((await b.post(`/api/phones/${phoneId}/contacts`, { name: "x", number: "+4512345678" })).status).toBe(404);
    expect((await b.get("/api/phones")).json.phones).toHaveLength(0);
  });

  it("removes a phone and its DNS client; the old device token stops working", async () => {
    const a = await signIn(h, "a@example.org");
    const { phoneId, device } = await pairPhone(h, a);
    expect(h.dns.clients.size).toBe(1);
    expect((await a.del(`/api/phones/${phoneId}`)).json).toEqual({ status: "applied" });
    expect(h.dns.clients.size).toBe(0);
    expect((await device.get("/api/device/rules")).status).toBe(401);
  });
});
