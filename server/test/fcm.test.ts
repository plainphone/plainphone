// SPDX-License-Identifier: Apache-2.0
import { generateKeyPairSync } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createFcmProvider } from "../src/providers/fcm.js";
import { notifyUsers } from "../src/services/notifications.js";
import { signIn, useHarness } from "./harness.js";

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
  const { json: me } = await parent.get("/api/me");
  expect((await parent.post("/api/notifications/subscriptions", { platform: "fcm", token })).status).toBe(201);
  expect((await parent.post("/api/notifications/subscriptions", { platform: "apns", token: "b".repeat(40) })).status).toBe(201);
  const approval = { type: "approval" as const, phoneName: "Private phone name" };
  expect(await notifyUsers(h.ctx, [me.user.id], approval)).toBe(1);

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

  expect(await notifyUsers(h.ctx, [me.user.id], approval)).toBe(0);
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
