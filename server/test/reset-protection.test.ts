// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { frpAccounts } from "../src/db/schema.js";
import { GOOGLE_PEOPLE_URL, GOOGLE_TOKEN_URL } from "../src/services/reset-protection.js";
import { Client, pairPhone, PUBLIC_URL, signIn, useHarness } from "./harness.js";

const h = useHarness();
const CLIENT_ID = "test-client.apps.googleusercontent.com";

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(payload)}.sig`;
}

/** Plays Google's token endpoint. `sub` is the account ID Google would return. */
function fakeGoogle(token: Record<string, unknown> | ((body: URLSearchParams) => Record<string, unknown>), status = 200) {
  const calls: URLSearchParams[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url) === GOOGLE_PEOPLE_URL) {
      const id = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "");
      return Response.json({ resourceName: `people/${id}` });
    }
    expect(String(url)).toBe(GOOGLE_TOKEN_URL);
    const body = new URLSearchParams(String(init?.body));
    calls.push(body);
    const payload = typeof token === "function" ? token(body) : token;
    return new Response(JSON.stringify({ id_token: jwt(payload), access_token: String(payload.sub) }), { status });
  });
  return calls;
}

const goodToken = (over: Record<string, unknown> = {}) => ({
  iss: "https://accounts.google.com",
  aud: CLIENT_ID,
  sub: "118000000000000000001",
  exp: Math.floor(h.clock.now.getTime() / 1000) + 3600,
  ...over,
});

async function startLogin(parent: Client, hid: string) {
  const r = await parent.post(`/api/households/${hid}/reset-protection/google`);
  expect(r.status).toBe(200);
  const url = new URL(r.json.url);
  return { url, state: url.searchParams.get("state")! };
}

async function callback(query: Record<string, string>) {
  const r = await new Client(h).get(`/api/reset-protection/google/callback?${new URLSearchParams(query)}`);
  expect(r.status).toBe(302);
  return r.headers.get("location");
}

describe("reset protection", () => {
  beforeEach(() => {
    h.ctx.cfg.GOOGLE_OAUTH_CLIENT_ID = CLIENT_ID;
    h.ctx.cfg.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
  });
  afterEach(() => vi.restoreAllMocks());

  it("is reported as not set up without a Google client", async () => {
    h.ctx.cfg.GOOGLE_OAUTH_CLIENT_ID = undefined;
    const parent = await signIn(h, "mum@example.org");
    const hid = (await parent.get("/api/me")).json.households[0].id;
    const state = await parent.get(`/api/households/${hid}/reset-protection`);
    expect(state.json).toEqual({ available: false, accounts: [] });
    expect((await parent.post(`/api/households/${hid}/reset-protection/google`)).status).toBe(409);
  });

  it("uses the People API without an email scope, stores the account ID and no email, and syncs it to the phone", async () => {
    const parent = await signIn(h, "mum@example.org");
    const hid = (await parent.get("/api/me")).json.households[0].id;
    const { device } = await pairPhone(h, parent);
    expect((await device.get("/api/device/rules")).json.resetProtection).toEqual({ accountIds: [] });

    const { url, state } = await startLogin(parent, hid);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe("openid https://www.googleapis.com/auth/userinfo.profile");
    expect(url.searchParams.get("redirect_uri")).toBe(`${PUBLIC_URL}/api/reset-protection/google/callback`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");

    const calls = fakeGoogle(goodToken({ email: "mum@gmail.example" }));
    expect(await callback({ code: "c1", state })).toBe(`${PUBLIC_URL}/household?reset-protection=ok`);
    expect(calls[0]!.get("code_verifier")).toBeTruthy();
    expect(calls[0]!.get("client_secret")).toBe("test-secret");

    const rows = await h.ctx.db.select().from(frpAccounts);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("gmail");
    expect((await device.get("/api/device/rules")).json.resetProtection).toEqual({ accountIds: ["118000000000000000001"] });

    const summary = (await parent.get(`/api/households/${hid}/reset-protection`)).json;
    expect(summary.available).toBe(true);
    expect(summary.accounts).toHaveLength(1);
    expect(summary.accounts[0].mine).toBe(true);
    expect(summary.accounts[0].activeFrom).toBe(new Date(h.clock.now.getTime() + 72 * 3600_000).toISOString());
    expect(JSON.stringify(summary)).not.toContain("118000000000000000001");

    // The state is single-use.
    expect(await callback({ code: "c1", state })).toBe(`${PUBLIC_URL}/household?reset-protection=failed`);
  });

  it("returns a bearer-authenticated native parent to the app", async () => {
    const parent = await signIn(h, "mum@example.org");
    const hid = (await parent.get("/api/me")).json.households[0].id;
    const started = await parent.call("POST", `/api/households/${hid}/reset-protection/google`, {}, {
      "x-plainphone-app": "parent",
    });
    expect(started.status).toBe(200);
    const state = new URL(started.json.url).searchParams.get("state")!;
    fakeGoogle(goodToken());
    expect(await callback({ code: "c", state })).toBe("plainphone://household?reset-protection=ok");
  });

  it("removing it clears the ID on the next sync", async () => {
    const parent = await signIn(h, "mum@example.org");
    const hid = (await parent.get("/api/me")).json.households[0].id;
    const { device } = await pairPhone(h, parent);
    const { state } = await startLogin(parent, hid);
    fakeGoogle(goodToken());
    await callback({ code: "c", state });
    const before = await device.get("/api/device/rules");
    expect((await parent.del(`/api/households/${hid}/reset-protection/mine`)).status).toBe(204);
    const after = await device.get("/api/device/rules", { "if-none-match": before.headers.get("etag")! });
    expect(after.status).toBe(200);
    expect(after.json.resetProtection.accountIds).toEqual([]);
  });

  it("lets a second guardian add their own account, and drops it when they leave", async () => {
    const mum = await signIn(h, "mum@example.org");
    const hid = (await mum.get("/api/me")).json.households[0].id;
    const { device } = await pairPhone(h, mum);
    const inv = await mum.post(`/api/households/${hid}/invites`, { email: "dad@example.org" });
    expect(inv.status).toBe(201);
    const token = decodeURIComponent(/invite#token=(\S+)/.exec(h.mail.outbox.at(-1)!.text)![1]!);
    const dad = await signIn(h, "dad@example.org");
    await dad.post("/api/invites/accept", { token });
    const dadId = (await dad.get("/api/me")).json.user.id;

    let next = "1";
    fakeGoogle(() => goodToken({ sub: next }));
    await callback({ code: "m", state: (await startLogin(mum, hid)).state });
    next = "2";
    await callback({ code: "d", state: (await startLogin(dad, hid)).state });
    expect((await device.get("/api/device/rules")).json.resetProtection.accountIds).toEqual(["1", "2"]);

    expect((await mum.del(`/api/households/${hid}/members/${dadId}`)).status).toBe(204);
    expect((await device.get("/api/device/rules")).json.resetProtection.accountIds).toEqual(["1"]);
  });

  it("refuses tokens for another client, from another issuer, expired or with a strange ID", async () => {
    const parent = await signIn(h, "mum@example.org");
    const hid = (await parent.get("/api/me")).json.households[0].id;
    for (const bad of [
      goodToken({ aud: "someone-else" }),
      goodToken({ iss: "https://evil.example" }),
      goodToken({ exp: Math.floor(h.clock.now.getTime() / 1000) - 3600 }),
      goodToken({ sub: "mum@gmail.example" }),
    ]) {
      vi.restoreAllMocks();
      fakeGoogle(bad);
      const { state } = await startLogin(parent, hid);
      expect(await callback({ code: "c", state })).toBe(`${PUBLIC_URL}/household?reset-protection=failed`);
    }
    expect(await h.ctx.db.select().from(frpAccounts)).toHaveLength(0);
  });

  it("handles a cancelled sign-in, an unknown state and a non-member", async () => {
    const parent = await signIn(h, "mum@example.org");
    const hid = (await parent.get("/api/me")).json.households[0].id;
    const { state } = await startLogin(parent, hid);
    expect(await callback({ error: "access_denied", state })).toBe(`${PUBLIC_URL}/household?reset-protection=cancelled`);
    expect(await callback({ code: "c", state: "made-up" })).toBe(`${PUBLIC_URL}/household?reset-protection=failed`);
    const stranger = await signIn(h, "stranger@example.org");
    expect((await stranger.get(`/api/households/${hid}/reset-protection`)).status).toBe(404);
    expect((await stranger.post(`/api/households/${hid}/reset-protection/google`)).status).toBe(404);
  });

  it("stores the phone's reset protection state and account types", async () => {
    const parent = await signIn(h, "mum@example.org");
    const { phoneId, device } = await pairPhone(h, parent);
    const r = await device.put("/api/device/status", {
      appVersion: "0.1.4",
      batteryPct: 50,
      charging: false,
      deviceOwner: true,
      lockIntact: true,
      maintenance: false,
      failedPolicies: [],
      rulesEtag: null,
      rulesAppliedAt: null,
      dnsHost: null,
      resetProtection: "on",
      accountTypes: ["com.google"],
    });
    expect(r.status).toBe(204);
    const status = (await parent.get(`/api/phones/${phoneId}`)).json.status;
    expect(status.resetProtection).toBe("on");
    expect(status.accountTypes).toEqual(["com.google"]);
  });
});
