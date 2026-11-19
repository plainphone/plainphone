// SPDX-License-Identifier: Apache-2.0
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { Apns, configureNativePush, Fcm, NativeParentPush } from "../src/providers/native-push.js";
import { NoParentPushProvider } from "../src/providers/parent-push.js";
import { PhonePushProvider } from "../src/providers/push.js";

const config = (vars: NodeJS.ProcessEnv = {}) => loadConfig({ DATABASE_URL: "unused", ...vars });
const parentTarget = { endpoint: "x".repeat(64), p256dh: null, auth: null };
const notification = { title: "Alert", body: "Open the app", url: "/approvals", tag: "alert" };
const web = new NoParentPushProvider();
const privateKey = (key: KeyObject) =>
  key.export({ type: "pkcs8", format: "pem" }).toString();

describe("native push", () => {
  it("keeps providers disabled independently when credentials are missing", async () => {
    const { fcm, apns } = configureNativePush(config({ APNS_KEY_ID: "partial" }));
    const push = new NativeParentPush(web, fcm, apns);
    for (const platform of ["apns", "fcm", "web"] as const) {
      expect(push.enabled(platform)).toBe(false);
      expect(await push.send({ ...parentTarget, platform }, notification)).toBe("unsupported");
    }
  });

  it("authorizes FCM HTTP v1, marks SOS urgent and strips all content from wakeups", async () => {
    const http = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "fake-access", expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({ name: "message-1" }))
      .mockResolvedValueOnce(Response.json({ error: { details: [{
        "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED",
      }] } }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ error: { status: "INVALID_ARGUMENT" } }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ error: { details: [{
        "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "INVALID_ARGUMENT",
      }] } }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ error: { details: [{
        "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "SENDER_ID_MISMATCH",
      }] } }, { status: 403 }));
    const fcm = new Fcm(JSON.stringify({
      project_id: "demo-project", client_email: "demo@example.org",
      private_key: privateKey(generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey),
    }), http);
    const push = new NativeParentPush(web, fcm);
    const send = () => push.send({ ...parentTarget, platform: "fcm" }, notification, { urgent: true });
    expect(await send()).toBe("sent");
    expect(http.mock.calls[0]![0]).toBe("https://oauth2.googleapis.com/token");
    const [destination, request] = http.mock.calls[1]!;
    expect(destination).toBe("https://fcm.googleapis.com/v1/projects/demo-project/messages:send");
    expect(request?.headers).toMatchObject({ authorization: "Bearer fake-access" });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      message: { android: { priority: "HIGH", notification: { channel_id: "sos" } }, data: { url: "/approvals" } },
    });
    const wake = new PhonePushProvider(config({ PUSH_PROVIDER: "fcm" }), fcm);
    expect(await wake.wake(parentTarget.endpoint, "locate")).toBe("gone");
    expect(JSON.parse(String(http.mock.calls[2]![1]?.body))).toEqual({
      message: { token: parentTarget.endpoint, data: { wake: "locate" },
        android: { priority: "HIGH", ttl: "60s", collapse_key: "plainphone-sync" } },
    });
    expect(await send()).toBe("failed");
    expect(await send()).toBe("gone");
    expect(await wake.validateFcmToken(parentTarget.endpoint)).toBe("gone");
    expect(JSON.parse(String(http.mock.calls[5]![1]?.body))).toEqual({
      validate_only: true, message: { token: parentTarget.endpoint, data: { wake: "rules" } },
    });
  });

  it("sends time-sensitive APNs alerts and treats an expired token as gone", async () => {
    const http = vi.fn().mockResolvedValueOnce({ status: 200, body: "" }).mockResolvedValueOnce({ status: 410, body: "" });
    const apns = new Apns(privateKey(generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey),
      "key-id", "team-id", "org.plainphone.parent", true, http);
    const push = new NativeParentPush(web, undefined, apns);
    const target = { ...parentTarget, platform: "apns" } as const;
    expect(await push.send(target, notification, { urgent: true })).toBe("sent");
    expect(http.mock.calls[0]![0]).toBe("https://api.sandbox.push.apple.com");
    expect(http.mock.calls[0]![1]).toMatchObject({
      ":path": `/3/device/${target.endpoint}`, "apns-priority": "10", "apns-push-type": "alert",
      "apns-topic": "org.plainphone.parent", authorization: expect.stringMatching(/^bearer /),
    });
    expect(JSON.parse(http.mock.calls[0]![2])).toMatchObject({ aps: { "interruption-level": "time-sensitive" } });
    expect(await push.send(target, notification)).toBe("gone");
    expect(JSON.parse(http.mock.calls[1]![2]).aps["interruption-level"]).toBeUndefined();
  });

  describe("action buttons on a request for more time", () => {
    const requestId = "11111111-2222-4333-8444-555555555555";
    const phoneId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const buttons = [{ id: "15", title: "15 min" }, { id: "60", title: "1 hour" }, { id: "day", title: "Rest of the day" }, { id: "no", title: "No" }];
    const moreTime = { ...notification, url: `/phones/${phoneId}`, tag: "moretime-1", data: { type: "more-time", phoneId, requestId }, actions: buttons };

    it("gives APNs the category and the ids the app needs to answer", async () => {
      const http = vi.fn().mockResolvedValue({ status: 200, body: "" });
      const apns = new Apns(privateKey(generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey),
        "key-id", "team-id", "org.plainphone.parent", true, http);
      const push = new NativeParentPush(web, undefined, apns);
      expect(await push.send({ ...parentTarget, platform: "apns" }, moreTime)).toBe("sent");
      expect(JSON.parse(http.mock.calls[0]![2])).toMatchObject({
        aps: { category: "more-time", alert: { title: "Alert" } }, type: "more-time", phoneId, requestId,
      });
    });

    it("sends FCM a data-only message that the parent app draws with buttons", async () => {
      const http = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ access_token: "fake-access", expires_in: 3600 }))
        .mockResolvedValue(Response.json({ name: "message-1" }));
      const fcm = new Fcm(JSON.stringify({
        project_id: "demo-project", client_email: "demo@example.org",
        private_key: privateKey(generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey),
      }), http);
      const push = new NativeParentPush(web, fcm);
      const target = { ...parentTarget, platform: "fcm" } as const;
      expect(await push.send(target, moreTime)).toBe("sent");
      const { message } = JSON.parse(String(http.mock.calls[1]![1]?.body));
      expect(message.notification).toBeUndefined();
      expect(message.data).toMatchObject({
        title: "Alert", message: "Open the app", categoryId: "more-time", channelId: "normal", type: "more-time", phoneId, requestId,
      });
      expect(JSON.parse(message.data.body)).toMatchObject({ type: "more-time", phoneId, requestId });
      // Everything else keeps the notification block, which Android draws by itself.
      expect(await push.send(target, notification)).toBe("sent");
      expect(JSON.parse(String(http.mock.calls[2]![1]?.body)).message.notification).toEqual({ title: "Alert", body: "Open the app" });
    });

    it("hands Web Push the buttons and the ids for the service worker", async () => {
      const sent: unknown[] = [];
      const recording = { name: "x", webPublicKey: "k", async send(_t: unknown, m: unknown) { sent.push(m); return "sent" as const; } };
      const push = new NativeParentPush(recording, undefined, undefined);
      expect(await push.send({ platform: "web", endpoint: "https://fcm.googleapis.com/x", p256dh: "p", auth: "a" }, moreTime)).toBe("sent");
      expect(sent[0]).toMatchObject({ actions: buttons, data: { type: "more-time", phoneId, requestId } });
    });
  });

  it("only posts UnifiedPush wakes to trusted HTTPS endpoints, without following redirects", async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 410 }));
    const push = new PhonePushProvider(config({ PUSH_PROVIDER: "unifiedpush", PUSH_EXTRA_HOSTS: "push.example.org" }), undefined, http);
    const endpoint = "https://push.example.org/up-secret";
    for (const url of ["https://push.example.org.evil.org/up", "http://push.example.org/up", "https://push.example.org:8443/up"]) {
      await push.wake(url, "rules", "unifiedpush");
    }
    expect(http).not.toHaveBeenCalled();
    expect(await push.wake(endpoint, "update", "unifiedpush")).toBe("gone");
    expect(http).toHaveBeenCalledWith(endpoint, expect.objectContaining({ redirect: "error", body: '{"wake":"update"}' }));
  });
});
