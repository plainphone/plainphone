// SPDX-License-Identifier: Apache-2.0
import { generateKeyPairSync, verify, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createH2Server, type IncomingHttpHeaders, type ServerHttp2Stream } from "node:http2";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { ApnsSender, FcmSender, nativeSendersFromConfig, parseServiceAccount } from "../src/providers/native-push.js";
import { type PushMessage, ParentPushRouter } from "../src/providers/parent-push.js";
import { signIn, useHarness } from "./harness.js";

const msg: PushMessage = {
  title: "Protection removed on Ada",
  body: "Open the app",
  url: "/phones/6f1c2a8e-9b3d-4c5e-8f7a-1b2c3d4e5f60",
  tag: "lock-6f1c2a8e",
  channel: "alerts",
};

function jwtParts(jwt: string) {
  const [h, c, s] = jwt.split(".");
  return {
    header: JSON.parse(Buffer.from(h!, "base64url").toString()),
    claims: JSON.parse(Buffer.from(c!, "base64url").toString()),
    input: `${h}.${c}`,
    sig: Buffer.from(s!, "base64url"),
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
  });
}

describe("FCM HTTP v1", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const seen: { path: string; auth?: string; body: string }[] = [];
  let tokenCalls = 0;
  let next: { status: number; body: unknown } = { status: 200, body: { name: "projects/p/messages/1" } };
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const body = await readBody(req);
    if (req.url === "/token") {
      tokenCalls++;
      const assertion = new URLSearchParams(body).get("assertion")!;
      const j = jwtParts(assertion);
      const ok = verify("RSA-SHA256", Buffer.from(j.input), publicKey, j.sig);
      res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
      res.end(JSON.stringify({ access_token: `at-${tokenCalls}`, expires_in: 3600, claims: j.claims }));
      seen.push({ path: req.url, body: JSON.stringify(j.claims) });
      return;
    }
    seen.push({ path: req.url!, auth: req.headers.authorization, body });
    res.writeHead(next.status, { "content-type": "application/json" });
    res.end(JSON.stringify(next.body));
  });
  const ready = new Promise<string>((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  afterAll(() => server.close());

  async function sender() {
    const base = await ready;
    const sa = { project_id: "plainphone-test", client_email: "push@test.iam", private_key: pem, token_uri: `${base}/token` };
    return new FcmSender(parseServiceAccount(Buffer.from(JSON.stringify(sa)).toString("base64")), { apiBase: base });
  }

  it("signs in with the service account and sends to the token", async () => {
    const s = await sender();
    expect(await s.send("fcm-token-1", msg, { urgent: true })).toBe("sent");
    const claims = JSON.parse(seen.find((x) => x.path === "/token")!.body);
    expect(claims).toMatchObject({ iss: "push@test.iam", scope: "https://www.googleapis.com/auth/firebase.messaging" });
    const sent = seen.at(-1)!;
    expect(sent.path).toBe("/v1/projects/plainphone-test/messages:send");
    expect(sent.auth).toBe("Bearer at-1");
    expect(JSON.parse(sent.body)).toEqual({
      message: {
        token: "fcm-token-1",
        notification: { title: msg.title, body: msg.body },
        data: { url: msg.url, tag: msg.tag, channel: "alerts" },
        android: { priority: "HIGH", collapse_key: msg.tag, notification: { channel_id: "alerts", tag: msg.tag } },
      },
    });
    // The access token is reused.
    expect(await s.send("fcm-token-1", msg)).toBe("sent");
    expect(tokenCalls).toBe(1);
    expect(JSON.parse(seen.at(-1)!.body).message.android.priority).toBe("NORMAL");
  });

  it("drops tokens FCM no longer knows, and keeps others on errors", async () => {
    const s = await sender();
    next = { status: 404, body: { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } } };
    expect(await s.send("old", msg)).toBe("gone");
    next = { status: 403, body: { error: { status: "PERMISSION_DENIED", details: [{ errorCode: "SENDER_ID_MISMATCH" }] } } };
    expect(await s.send("other-project", msg)).toBe("gone");
    next = { status: 503, body: { error: { status: "UNAVAILABLE" } } };
    expect(await s.send("fine", msg)).toBe("failed");
    next = { status: 200, body: {} };
  });

  it("refuses a broken service account without echoing it", () => {
    expect(() => parseServiceAccount("not json at all")).toThrow(/not valid JSON/);
    expect(() => parseServiceAccount('{"project_id":"x"}')).toThrow(/needs project_id/);
  });
});

describe("APNs", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const p8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const seen: { headers: IncomingHttpHeaders; body: string }[] = [];
  let reply: { status: number; reason?: string } = { status: 200 };
  const server = createH2Server();
  server.on("stream", (stream: ServerHttp2Stream, headers: IncomingHttpHeaders) => {
    let body = "";
    stream.setEncoding("utf8");
    stream.on("data", (d: string) => (body += d));
    stream.on("end", () => {
      seen.push({ headers, body });
      stream.respond({ ":status": reply.status, "content-type": "application/json" });
      stream.end(reply.reason ? JSON.stringify({ reason: reply.reason }) : "");
    });
  });
  const ready = new Promise<string>((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  const senders: ApnsSender[] = [];
  afterAll(() => {
    for (const s of senders) s.close();
    server.close();
  });

  async function sender(key: string = p8) {
    const s = new ApnsSender(
      { keyId: "KEY1234567", teamId: "TEAM123456", key, topic: "org.plainphone.parent", environment: "production" },
      { origin: await ready },
    );
    senders.push(s);
    return s;
  }
  const token = "a".repeat(64);

  function verifyEs256(jwt: string, key: KeyObject) {
    const j = jwtParts(jwt);
    return { ...j, ok: verify("SHA256", Buffer.from(j.input), { key, dsaEncoding: "ieee-p1363" }, j.sig) };
  }

  it("sends an alert for the app's bundle id with a signed token", async () => {
    const s = await sender(Buffer.from(p8).toString("base64"));
    expect(await s.send(token, msg, { urgent: true })).toBe("sent");
    const { headers, body } = seen.at(-1)!;
    expect(headers[":path"]).toBe(`/3/device/${token}`);
    expect(headers["apns-topic"]).toBe("org.plainphone.parent");
    expect(headers["apns-push-type"]).toBe("alert");
    expect(headers["apns-priority"]).toBe("10");
    expect(headers["apns-collapse-id"]).toBe(msg.tag);
    const jwt = verifyEs256(String(headers.authorization).replace(/^bearer /, ""), publicKey);
    expect(jwt.ok).toBe(true);
    expect(jwt.header).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(jwt.claims.iss).toBe("TEAM123456");
    expect(JSON.parse(body)).toEqual({
      aps: { alert: { title: msg.title, body: msg.body }, "thread-id": msg.tag },
      url: msg.url,
      tag: msg.tag,
      channel: "alerts",
    });
    expect(await s.send(token, msg)).toBe("sent");
    expect(seen.at(-1)!.headers["apns-priority"]).toBe("5");
  });

  it("drops tokens Apple rejects for good, keeps them on other errors", async () => {
    const s = await sender();
    reply = { status: 410, reason: "Unregistered" };
    expect(await s.send(token, msg)).toBe("gone");
    reply = { status: 400, reason: "BadDeviceToken" };
    expect(await s.send(token, msg)).toBe("gone");
    reply = { status: 500, reason: "InternalServerError" };
    expect(await s.send(token, msg)).toBe("failed");
    reply = { status: 200 };
    // Not a device token at all: never sent.
    const before = seen.length;
    expect(await s.send("../../etc", msg)).toBe("gone");
    expect(seen.length).toBe(before);
  });

  it("refuses a broken key", () => {
    expect(
      () => new ApnsSender({ keyId: "K", teamId: "T", key: "bm9wZQ==", topic: "x", environment: "production" }),
    ).toThrow(/not a valid .p8/);
  });

  it("takes team and topic from APPLE_APP_IDS", () => {
    const [apns] = nativeSendersFromConfig({
      APPLE_APP_IDS: "TEAM123456.org.plainphone.parent",
      APNS_KEY_P8: p8,
      APNS_KEY_ID: "KEY1234567",
      APNS_ENVIRONMENT: "production",
    });
    expect(apns?.name).toBe("apns");
    expect(nativeSendersFromConfig({ APPLE_APP_IDS: "", APNS_ENVIRONMENT: "production" })).toEqual([]);
    // Compose passes unset variables as empty strings.
    expect(
      nativeSendersFromConfig({ APPLE_APP_IDS: "T.x", APNS_KEY_P8: "", APNS_KEY_ID: "", APNS_TEAM_ID: "", FCM_SERVICE_ACCOUNT_JSON: "", APNS_ENVIRONMENT: "production" }),
    ).toEqual([]);
  });
});

describe("router", () => {
  it("sends each subscription through its own channel", async () => {
    const calls: string[] = [];
    const fake = (name: "apns" | "fcm") => ({
      name,
      async send(t: string) {
        calls.push(`${name}:${t}`);
        return "sent" as const;
      },
    });
    const r = new ParentPushRouter(null, [fake("fcm")]);
    expect(r.name).toBe("fcm");
    expect([...r.platforms]).toEqual(["fcm"]);
    expect(r.webPublicKey).toBeNull();
    expect(await r.send({ platform: "fcm", endpoint: "t1", p256dh: null, auth: null }, msg)).toBe("sent");
    expect(await r.send({ platform: "apns", endpoint: "t2", p256dh: null, auth: null }, msg)).toBe("unsupported");
    expect(await r.send({ platform: "web", endpoint: "https://x", p256dh: "a", auth: "b" }, msg)).toBe("unsupported");
    expect(calls).toEqual(["fcm:t1"]);
  });
});

describe("native subscriptions", () => {
  const h = useHarness();

  it("delivers to an app token and tells the app which channels work", async () => {
    const me = await signIn(h, "parent@example.test");
    const token = "f".repeat(152);
    const sub = await me.post("/api/notifications/subscriptions", { platform: "fcm", token, label: "Pixel" });
    expect(sub.status).toBe(201);
    const info = await me.get("/api/notifications");
    expect(info.json.nativePush).toEqual({ apns: true, fcm: true });
    const t = await me.post("/api/notifications/test", { subscriptionId: sub.json.id });
    expect(t.json.sent).toBe(1);
    expect(h.parentPush.sent).toEqual([
      expect.objectContaining({ endpoint: token, platform: "fcm", msg: expect.objectContaining({ channel: "alerts", url: "/settings" }) }),
    ]);
  });
});
