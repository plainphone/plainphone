// SPDX-License-Identifier: Apache-2.0
import { createECDH, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { DELIVERY, pushClass, WAKE_TTL_SECONDS } from "../src/lib/push-priority.js";
import { generateVapidKeys } from "../src/lib/webpush.js";
import { Apns, Fcm, NativeParentPush } from "../src/providers/native-push.js";
import { NoParentPushProvider, WebPushProvider } from "../src/providers/parent-push.js";
import { PhonePushProvider } from "../src/providers/push.js";

const NOW = new Date("2026-11-20T12:00:00Z");
const privateKey = (key: KeyObject) => key.export({ type: "pkcs8", format: "pem" }).toString();
const message = { title: "Alma", body: "Needs help", url: "/phones/p", tag: "sos1", receipt: "r".repeat(22) };
const target = { endpoint: "x".repeat(64), p256dh: null, auth: null };

function fcmWith() {
  const http = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ access_token: "fake-access", expires_in: 3600 }))
    .mockResolvedValue(Response.json({ name: "message-1" }));
  const fcm = new Fcm(JSON.stringify({
    project_id: "demo-project", client_email: "demo@example.org",
    private_key: privateKey(generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey),
  }), http);
  const body = (call: number) => JSON.parse(String(http.mock.calls[call]![1]?.body)).message;
  return { fcm, body };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("push priority per message kind", () => {
  it.each([
    ["sos", true, "alarm"],
    ["protection", true, "alarm"],
    ["sos", false, "prompt"],
    ["quickMessage", false, "prompt"],
    ["checkIn", false, "prompt"],
    ["safety", false, "prompt"],
    ["moreTime", false, "prompt"],
    ["request-on-phone", false, "prompt"],
    ["test", false, "prompt"],
    ["offline", false, "normal"],
    ["summary", false, "normal"],
    ["moreTimeReceipt", false, "normal"],
  ] as const)("%s (urgent %s) is %s", (type, urgent, cls) => {
    expect(pushClass(type, urgent)).toBe(cls);
  });

  it("keeps alerts longer than wakeups, and a ring shortest of all", () => {
    expect(DELIVERY.alarm.ttlSeconds).toBe(86_400);
    expect(WAKE_TTL_SECONDS.ring).toBe(120);
    expect(Math.min(...Object.values(WAKE_TTL_SECONDS))).toBe(WAKE_TTL_SECONDS.ring);
    expect(WAKE_TTL_SECONDS.locate).toBeLessThan(WAKE_TTL_SECONDS.rules);
    expect(Math.max(...Object.values(WAKE_TTL_SECONDS))).toBeLessThan(DELIVERY.prompt.ttlSeconds);
  });
});

describe("FCM", () => {
  it.each([
    ["alarm", "HIGH", "sos", "86400s"],
    ["prompt", "HIGH", "normal", "14400s"],
    ["normal", "NORMAL", "normal", "86400s"],
  ] as const)("sends %s with priority %s on channel %s and TTL %s, never collapsible", async (priority, fcmPriority, channel, ttl) => {
    const { fcm, body } = fcmWith();
    const push = new NativeParentPush(new NoParentPushProvider(), fcm);
    expect(await push.send({ ...target, platform: "fcm" }, message, { priority })).toBe("sent");
    const sent = body(1);
    expect(sent.android).toEqual({ priority: fcmPriority, ttl, notification: { channel_id: channel, tag: "sos1" } });
    expect(sent.android.collapse_key).toBeUndefined();
    expect(sent.data.receipt).toBe(message.receipt);
  });

  it.each(Object.entries(WAKE_TTL_SECONDS))("wakes the child phone for %s with a high-priority data message and TTL %is", async (reason, ttl) => {
    const { fcm, body } = fcmWith();
    const wake = new PhonePushProvider(loadConfig({ DATABASE_URL: "unused", PUSH_PROVIDER: "fcm" }), fcm);
    await wake.wake("token", reason as keyof typeof WAKE_TTL_SECONDS);
    // A ring goes out as an ordinary rules wake: older phones only know the four reasons.
    const wire = reason === "ring" ? "rules" : reason;
    expect(body(1)).toEqual({ token: "token", data: { wake: wire }, android: { priority: "HIGH", ttl: `${ttl}s`, collapse_key: "plainphone-sync" } });
  });
});

describe("UnifiedPush", () => {
  it("sends child wakeups with high urgency and the reason's TTL", async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 201 }));
    const push = new PhonePushProvider(loadConfig({ DATABASE_URL: "unused", PUSH_PROVIDER: "unifiedpush", PUSH_EXTRA_HOSTS: "push.example.org" }), undefined, http);
    await push.wake("https://push.example.org/up", "locate", "unifiedpush");
    expect(http.mock.calls[0]![1]?.headers).toMatchObject({ urgency: "high", ttl: "120" });
  });
});

describe("APNs", () => {
  it.each([
    ["alarm", "10", "time-sensitive", 86_400],
    ["prompt", "10", undefined, 14_400],
    ["normal", "5", undefined, 86_400],
  ] as const)("sends %s with apns-priority %s, interruption %s and an expiration", async (priority, apnsPriority, level, ttl) => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const http = vi.fn().mockResolvedValue({ status: 200, body: "" });
    const apns = new Apns(privateKey(generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey),
      "key-id", "team-id", "org.plainphone.app", false, http);
    const push = new NativeParentPush(new NoParentPushProvider(), undefined, apns);
    expect(await push.send({ ...target, platform: "apns" }, message, { priority })).toBe("sent");
    const [, headers, payload] = http.mock.calls[0]!;
    expect(headers).toMatchObject({
      "apns-topic": "org.plainphone.app", "apns-push-type": "alert", "apns-priority": apnsPriority,
      "apns-expiration": String(NOW.getTime() / 1000 + ttl),
    });
    expect(JSON.parse(payload).aps["interruption-level"]).toBe(level);
    expect(JSON.parse(payload).receipt).toBe(message.receipt);
  });
});

describe("Web Push", () => {
  const subscriber = () => {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    return { platform: "web" as const, endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
  };

  it.each([
    ["alarm", "high", "86400"],
    ["prompt", "high", "14400"],
    ["normal", "normal", "86400"],
  ] as const)("sends %s with Urgency %s and TTL %s", async (priority, urgency, ttl) => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 201 }));
    const web = new WebPushProvider(generateVapidKeys(), "mailto:ops@example.org");
    expect(await web.send(subscriber(), message, { priority })).toBe("sent");
    expect(fetch.mock.calls[0]![1]?.headers).toMatchObject({ urgency, ttl, topic: "sos1" });
  });

  it("treats a bare urgent flag as an alarm", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 201 }));
    const web = new WebPushProvider(generateVapidKeys(), "mailto:ops@example.org");
    await web.send(subscriber(), message, { urgent: true });
    expect(fetch.mock.calls[0]![1]?.headers).toMatchObject({ urgency: "high", ttl: "86400" });
  });
});
