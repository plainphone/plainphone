// SPDX-License-Identifier: Apache-2.0
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { parentPushEnabled } from "../src/providers/parent-push.js";
import { generateVapidKeys } from "../src/lib/webpush.js";
import { normalizeApnsKey, normalizeServiceAccount } from "../src/providers/native-push.js";
import { buildOptionalProviders } from "../src/services/providers.js";
import { PUBLIC_URL, useHarness } from "./harness.js";

const h = useHarness();
afterEach(() => vi.restoreAllMocks());

const pem = (type: "rsa" | "ec") =>
  (type === "rsa"
    ? generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
    : generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey
  ).export({ type: "pkcs8", format: "pem" }).toString();
const account = () => JSON.stringify({ project_id: "demo-project", client_email: "demo@example.org", private_key: pem("rsa") });
const b64 = (text: string) => Buffer.from(text).toString("base64");
const apnsVars = { APNS_KEY_ID: "kid", APNS_TEAM_ID: "team", APNS_BUNDLE_ID: "org.example.app" };

const build = (vars: NodeJS.ProcessEnv = {}) =>
  buildOptionalProviders(loadConfig({ DATABASE_URL: "unused", PUBLIC_URL, NODE_ENV: "test", ...vars }));

async function health(vars: NodeJS.ProcessEnv) {
  const providers = build(vars);
  const cfg = loadConfig({ DATABASE_URL: "unused", PUBLIC_URL, NODE_ENV: "test", ...vars });
  const res = await createApp({ ...h.ctx, cfg, ...providers }).request("/api/health");
  return { status: res.status, json: (await res.json()) as { push: Record<string, unknown>; errors: string[]; mail: string } };
}

describe("FCM service account formats", () => {
  it("accepts raw JSON, with surrounding whitespace", async () => {
    const json = account();
    expect(normalizeServiceAccount(`  ${json}\n`)).toBe(json);
    const { json: body } = await health({ FCM_SERVICE_ACCOUNT_JSON: json });
    expect(body.push).toMatchObject({ fcm: true, errors: [] });
  });

  it("accepts base64 JSON, including base64url and wrapped lines", async () => {
    const json = account();
    expect(normalizeServiceAccount(b64(json))).toBe(json);
    expect(normalizeServiceAccount(Buffer.from(json).toString("base64url"))).toBe(json);
    expect(normalizeServiceAccount(b64(json).replace(/(.{60})/g, "$1\n"))).toBe(json);
    const { json: body } = await health({ FCM_SERVICE_ACCOUNT_JSON: b64(json) });
    expect(body.push).toMatchObject({ fcm: true, errors: [] });
  });

  it("rejects values that are neither", () => {
    for (const bad of ["not json at all", b64("plain text"), ""]) {
      expect(() => normalizeServiceAccount(bad)).toThrow();
    }
  });

  it("degrades on an invalid value: the server starts, FCM is off, health says why, the log has no secret", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "super-secret-value-123";
    const { status, json } = await health({ FCM_SERVICE_ACCOUNT_JSON: `{"private_key":"${secret}"` });
    expect(status).toBe(200);
    expect(json.push).toMatchObject({ fcm: false, errors: ["fcm: invalid service account"] });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(json)).not.toContain(secret);
  });

  it("degrades on a missing service account file, and a valid account in the wrong shape", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(build({ FCM_SERVICE_ACCOUNT_FILE: "/nonexistent/fcm.json" }).degraded?.push).toEqual(["fcm: service account file unreadable"]);
    expect(build({ FCM_SERVICE_ACCOUNT_JSON: b64(JSON.stringify({ project_id: "x" })) }).degraded?.push).toEqual(["fcm: invalid service account"]);
  });

  it("keeps web push working when FCM is invalid", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { publicKey, privateKey } = generateVapidKeys();
    const { json } = await health({ FCM_SERVICE_ACCOUNT_JSON: "garbage", VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey });
    expect(json.push).toMatchObject({ web: true, fcm: false });
  });
});

describe("APNs key formats", () => {
  const key = pem("ec");

  it("accepts PEM text, PEM with literal \\n escapes and base64 of the PEM", async () => {
    expect(normalizeApnsKey(key)).toBe(key.trim());
    expect(normalizeApnsKey(key.trim().replace(/\n/g, "\\n"))).toBe(key.trim());
    expect(normalizeApnsKey(b64(key))).toBe(key.trim());
    for (const value of [key, key.trim().replace(/\n/g, "\\n"), b64(key)]) {
      const { json } = await health({ APNS_KEY_P8: value, ...apnsVars });
      expect(json.push).toMatchObject({ apns: true, errors: [] });
    }
  });

  it("degrades on an invalid key or incomplete settings", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = await health({ APNS_KEY_P8: "-----BEGIN PRIVATE KEY-----\nbogus-secret\n-----END PRIVATE KEY-----", ...apnsVars });
    expect(bad.status).toBe(200);
    expect(bad.json.push).toMatchObject({ apns: false, errors: ["apns: invalid key"] });
    expect(JSON.stringify(log.mock.calls)).not.toContain("bogus-secret");
    expect(build({ APNS_KEY_P8: key, APNS_KEY_ID: "kid" }).degraded?.push).toEqual(["apns: incomplete configuration"]);
  });

  it("reports FCM and APNs problems independently", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { json } = await health({ FCM_SERVICE_ACCOUNT_JSON: "x", APNS_KEY_P8: "y", ...apnsVars });
    expect(json.push.errors).toEqual(["fcm: invalid service account", "apns: invalid key"]);
  });
});

describe("other optional integrations", () => {
  it("falls back to no mail when SMTP is selected without a usable URL", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const missing = await health({ MAIL_PROVIDER: "smtp" });
    expect(missing.status).toBe(200);
    expect(missing.json).toMatchObject({ mail: "none", errors: ["smtp: invalid or missing SMTP_URL"] });
    const bad = await health({ MAIL_PROVIDER: "smtp", SMTP_URL: "not a url ://user:hunter2@" });
    expect(bad.json).toMatchObject({ mail: "none", errors: ["smtp: invalid or missing SMTP_URL"] });
    expect(JSON.stringify(bad.json)).not.toContain("hunter2");
  });

  it("switches Web Push off on a half or mismatching VAPID pair", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(build({ VAPID_PUBLIC_KEY: "abc" }).degraded?.push).toEqual(["web: needs both VAPID keys"]);
    expect(build({ VAPID_PUBLIC_KEY: "abc", VAPID_PRIVATE_KEY: "def" }).degraded?.push).toEqual(["web: invalid VAPID key pair"]);
    expect(parentPushEnabled(build().parentPush, "web")).toBe(false);
  });

  it("degrades invalid switches to their defaults instead of crashing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(build({ APNS_SANDBOX: "TRUE" }).degraded).toEqual({ push: [], other: [] });
    expect(build({ APNS_SANDBOX: "1" }).degraded?.push).toEqual(["apns: invalid APNS_SANDBOX"]);
    expect(build({ PUSH_PROVIDER: "FCM" }).degraded?.push).toEqual([]);
    expect(build({ PUSH_PROVIDER: "gcm" }).degraded?.push).toEqual(["push: invalid PUSH_PROVIDER"]);
    expect(build({ MAIL_PROVIDER: "sendgrid" }).degraded?.other).toEqual(["mail: invalid MAIL_PROVIDER"]);
    const prod = await health({ NODE_ENV: "production", MAIL_PROVIDER: "log" });
    expect(prod).toMatchObject({ status: 200, json: { mail: "none" } });
  });

  it("stays quiet with no optional settings", () => {
    expect(build().degraded).toEqual({ push: [], other: [] });
  });
});
