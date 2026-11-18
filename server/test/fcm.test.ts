// SPDX-License-Identifier: Apache-2.0
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { pushSubscriptions } from "../src/db/schema.js";
import { createFcmProvider } from "../src/providers/fcm.js";
import { sweep } from "../src/services/sweeper.js";
import { notifyUsers } from "../src/services/notifications.js";
import { Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const credentials = JSON.stringify({
  project_id: "plainphone",
  client_email: "push@example.test",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
});
const token = "a".repeat(40);

it("sends private approval notifications without VAPID and removes unregistered tokens", async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ access_token: "mock-access", expires_in: 3600 }))
    .mockResolvedValueOnce(Response.json({ name: "projects/plainphone/messages/example" }))
    .mockResolvedValueOnce(Response.json({
      error: { details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] },
    }, { status: 404 }));
  h.ctx.parentPush = { name: "none", webPublicKey: null, send: async () => "unsupported" };
  h.ctx.nativeParentPush = createFcmProvider(Buffer.from(credentials).toString("base64"), fetchMock);
  const parent = await signIn(h, "parent@example.test");
  const owner = await signIn(h, "owner@example.test");
  const { phoneId, device } = await pairPhone(h, owner, { name: "Private phone name", profile: "self" });
  expect((await device.put("/api/device/apps", { apps: [
    { packageName: "com.instagram.android", label: "Instagram" },
    { packageName: "com.spotify.music", label: "Spotify" },
  ] })).status).toBe(204);
  const key = {
    keyType: "trusted", delayHours: 24, trustedEmail: "parent@example.test", payUnlockEnabled: false,
    payUnlockAmount: 50000, payUnlockRecipient: "plainphone",
  };
  expect((await owner.put(`/api/phones/${phoneId}/key`, key)).json.status).toBe("pending");
  h.clock.advance(24 * 3_600_000);
  await sweep(h.ctx);
  expect((await owner.get(`/api/phones/${phoneId}/key`)).json.trustedAccepted).toBe(true);

  expect((await owner.post("/api/notifications/subscriptions", { platform: "fcm", token: "c".repeat(40) })).status).toBe(201);
  expect((await parent.post("/api/notifications/subscriptions", { platform: "fcm", token })).status).toBe(201);
  expect((await parent.post("/api/notifications/subscriptions", { platform: "apns", token: "b".repeat(40) })).status).toBe(201);
  const requestApp = (name: string) => owner.put(`/api/phones/${phoneId}/apps/${name}`, { allowed: true });
  expect((await requestApp("com.instagram.android")).json.status).toBe("pending");
  expect(fetchMock).toHaveBeenCalledTimes(2);

  expect(fetchMock.mock.calls[0]?.[0]).toBe("https://oauth2.googleapis.com/token");
  const [url, init] = fetchMock.mock.calls[1]!;
  expect(url).toBe("https://fcm.googleapis.com/v1/projects/plainphone/messages:send");
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer mock-access");
  expect(JSON.parse(String(init?.body))).toEqual({
    message: {
      token,
      notification: { title: "An approval is waiting", body: "Open Plainphone to review it." },
      data: { type: "approval" },
      android: { notification: { channel_id: "approval" } },
    },
  });

  expect((await requestApp("com.spotify.music")).json.status).toBe("pending");
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect((await parent.get("/api/notifications")).json.subscriptions).toEqual([
    expect.objectContaining({ platform: "apns" }),
  ]);
});

it("warns once at initialization when FCM is off and leaves registrations alone", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const fetchMock = vi.fn<typeof fetch>();
  try {
    h.ctx.nativeParentPush = createFcmProvider(undefined, fetchMock);
    const parent = await signIn(h, "parent@example.test");
    await parent.post("/api/notifications/subscriptions", { platform: "fcm", token });
    expect((await parent.post("/api/notifications/test", {})).json).toEqual({ sent: 0 });
    expect((await parent.post("/api/notifications/test", {})).json).toEqual({ sent: 0 });
    expect((await parent.get("/api/notifications")).json.subscriptions).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  } finally {
    warn.mockRestore();
  }
});

it("retains an FCM subscription on a generic 404", async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ access_token: "mock-access", expires_in: 3600 }))
    .mockResolvedValueOnce(Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 }));
  h.ctx.nativeParentPush = createFcmProvider(credentials, fetchMock);
  const parent = await signIn(h, "parent@example.test");
  const { json: subscription } = await parent.post("/api/notifications/subscriptions", { platform: "fcm", token });

  expect((await parent.post("/api/notifications/test")).json).toEqual({ sent: 0 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect((await parent.get("/api/notifications")).json.subscriptions).toEqual([
    expect.objectContaining({ id: subscription.id }),
  ]);
});

it("cleans up only this install's native subscription on logout", async () => {
  const parent = await signIn(h, "parent@example.test");
  const otherInstall = await signIn(h, "parent@example.test");
  await parent.post("/api/notifications/subscriptions", { platform: "fcm", token });
  await parent.post("/api/notifications/subscriptions", { platform: "fcm", token: "c".repeat(40) });
  const { json: other } = await otherInstall.post("/api/notifications/subscriptions", {
    platform: "fcm", token: "b".repeat(40),
  });

  expect((await parent.post("/api/auth/logout")).status).toBe(204);
  expect((await parent.get("/api/me")).status).toBe(401);
  expect((await otherInstall.get("/api/notifications")).json.subscriptions).toEqual([
    expect.objectContaining({ id: other.id }),
  ]);
});

it("detaches the previous account's subscription when a native login link succeeds", async () => {
  const parent = await signIn(h, "parent@example.test");
  const sameAccount = await signIn(h, "parent@example.test");
  await parent.post("/api/notifications/subscriptions", { platform: "fcm", token });
  await parent.post("/api/auth/request", { email: "other@example.test", client: "native" });
  const link = decodeURIComponent(/#token=([^\s"&<]+)/.exec(h.mail.outbox.at(-1)!.text)![1]!);
  const verify = (token: string) => parent.post("/api/auth/verify", {
    client: "native", token,
  });

  expect((await verify("pp_m_invalid")).status).toBe(400);
  expect((await sameAccount.get("/api/notifications")).json.subscriptions).toHaveLength(1);
  const { status, json } = await verify(link);
  expect(status).toBe(200);
  expect((await parent.get("/api/me")).status).toBe(401);
  expect((await sameAccount.get("/api/notifications")).json.subscriptions).toEqual([]);
  const other = new Client(h);
  other.token = json.sessionToken;
  expect((await other.get("/api/notifications")).json.subscriptions).toEqual([]);
});

it("replaces a rotated token in the same session without a locally stored subscription ID", async () => {
  const parent = await signIn(h, "parent@example.test");
  await parent.post("/api/notifications/subscriptions", { platform: "fcm", token });
  const register = () => parent.post("/api/notifications/subscriptions", {
    platform: "fcm", token: "c".repeat(40),
  });
  const latest = await register();
  expect(latest.status).toBe(201);
  expect((await register()).json.id).toBe(latest.json.id);
  expect((await parent.get("/api/notifications")).json.subscriptions).toEqual([
    expect.objectContaining({ id: latest.json.id }),
  ]);
});

it("stops native delivery when the session expires and removes the subscription when swept", async () => {
  const prepare = vi.fn(async () => async () => "sent" as const);
  h.ctx.nativeParentPush = { platform: "fcm", prepare };
  const parent = await signIn(h, "parent@example.test");
  const { json: me } = await parent.get("/api/me");
  await parent.post("/api/notifications/subscriptions", { platform: "fcm", token });
  h.clock.advance(61 * 86_400_000);

  expect((await parent.get("/api/me")).status).toBe(401);
  expect(await notifyUsers(h.ctx, [me.user.id], { type: "test" })).toBe(0);
  expect(prepare).not.toHaveBeenCalled();

  await sweep(h.ctx);
  const next = await signIn(h, "parent@example.test");
  expect((await next.get("/api/notifications")).json.subscriptions).toEqual([]);
});

it.each(["logout", "switch accounts", "expire", "rotate token"] as const)(
  "skips the FCM POST if the registration loses eligibility during OAuth: %s",
  async (change) => {
    const oauthStarted = Promise.withResolvers<void>();
    const oauthResponse = Promise.withResolvers<Response>();
    const fetchMock = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => {
        oauthStarted.resolve();
        return oauthResponse.promise;
      })
      .mockResolvedValue(Response.json({ name: "projects/plainphone/messages/example" }));
    h.ctx.nativeParentPush = createFcmProvider(credentials, fetchMock);
    const parent = await signIn(h, "parent@example.test");
    const { json: me } = await parent.get("/api/me");
    expect((await parent.post("/api/notifications/subscriptions", { platform: "fcm", token })).status).toBe(201);
    const send = notifyUsers(h.ctx, [me.user.id], { type: "approval", phoneName: "Private phone name" });
    await oauthStarted.promise;

    try {
      if (change === "logout") {
        expect((await parent.post("/api/auth/logout")).status).toBe(204);
      } else if (change === "switch accounts") {
        await parent.post("/api/auth/request", { email: "other@example.test", client: "native" });
        const link = decodeURIComponent(/#token=([^\s"&<]+)/.exec(h.mail.outbox.at(-1)!.text)![1]!);
        expect((await parent.post("/api/auth/verify", { client: "native", token: link })).status).toBe(200);
      } else if (change === "expire") {
        h.clock.advance(61 * 86_400_000);
      } else {
        expect((await parent.post("/api/notifications/subscriptions", { platform: "fcm", token: "c".repeat(40) })).status).toBe(201);
      }
    } finally {
      oauthResponse.resolve(Response.json({ access_token: "mock-access", expires_in: 3600 }));
      await send;
    }
    expect(await send).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  },
);

it("removes only unbound native subscriptions during the cleanup migration", async () => {
  const parent = await signIn(h, "parent@example.test");
  const { json: me } = await parent.get("/api/me");
  await h.ctx.db.insert(pushSubscriptions).values([
    { userId: me.user.id, platform: "fcm", endpoint: "legacy-fcm" },
    { userId: me.user.id, platform: "apns", endpoint: "legacy-apns" },
    { userId: me.user.id, platform: "web", endpoint: "https://push.example.test/web" },
  ]);
  expect((await parent.post("/api/notifications/subscriptions", { platform: "fcm", token })).status).toBe(201);

  const migration = await readFile(new URL("../drizzle/0020_remove_unbound_native_push.sql", import.meta.url), "utf8");
  await h.ctx.db.execute(sql.raw(migration));
  const { json } = await parent.get("/api/notifications");
  expect(json.subscriptions.map((sub: { platform: string }) => sub.platform).sort()).toEqual(["fcm", "web"]);
});
