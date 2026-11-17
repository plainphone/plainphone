// SPDX-License-Identifier: Apache-2.0
//
// Push to the native parent app: APNs for iOS and FCM (HTTP v1) for Android. Both are
// sent straight from this server; no Expo push service or other relay sees the message.
// Credentials come from the environment (docs/parent-app.md, "Push notifications").

import { createPrivateKey, createSign, type KeyObject } from "node:crypto";
import { connect, constants, type ClientHttp2Session } from "node:http2";
import type { PushOutcome } from "../lib/webpush.js";
import type { PushMessage } from "./parent-push.js";

export interface NativeSendOpts {
  urgent?: boolean;
}

export interface NativeSender {
  readonly name: "apns" | "fcm";
  send(token: string, msg: PushMessage, opts?: NativeSendOpts): Promise<PushOutcome>;
  close?(): void;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function signJwt(header: object, claims: object, key: KeyObject, alg: "RS256" | "ES256"): string {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = createSign("SHA256")
    .update(input)
    .sign(alg === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key);
  return `${input}.${b64url(sig)}`;
}

/** The data the app reads when a notification is tapped (parent-app/src/lib/notifications.ts). */
function appData(msg: PushMessage): Record<string, string> {
  return { url: msg.url, tag: msg.tag, channel: msg.channel };
}

// --- FCM ---------------------------------------------------------------------------

export interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/** Parses the service account JSON (plain or base64). Throws with a short message, never echoing the key. */
export function parseServiceAccount(raw: string): FcmServiceAccount {
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw.trim(), "base64").toString("utf8");
  let j: Partial<FcmServiceAccount>;
  try {
    j = JSON.parse(text) as Partial<FcmServiceAccount>;
  } catch {
    throw new Error("FCM service account is not valid JSON");
  }
  if (!j.project_id || !j.client_email || !j.private_key) {
    throw new Error("FCM service account needs project_id, client_email and private_key");
  }
  return j as FcmServiceAccount;
}

export class FcmSender implements NativeSender {
  readonly name = "fcm";
  private readonly key: KeyObject;
  private access: { token: string; until: number } | null = null;
  private readonly tokenUri: string;
  private readonly sendUrl: string;

  constructor(
    private readonly sa: FcmServiceAccount,
    opts: { apiBase?: string; now?: () => number } = {},
  ) {
    this.key = createPrivateKey(sa.private_key);
    this.tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
    this.sendUrl = `${opts.apiBase ?? "https://fcm.googleapis.com"}/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`;
    this.now = opts.now ?? Date.now;
  }

  private readonly now: () => number;

  private async accessToken(): Promise<string> {
    const now = this.now();
    if (this.access && this.access.until > now + 60_000) return this.access.token;
    const iat = Math.floor(now / 1000);
    const assertion = signJwt(
      { alg: "RS256", typ: "JWT" },
      {
        iss: this.sa.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: this.tokenUri,
        iat,
        exp: iat + 3600,
      },
      this.key,
      "RS256",
    );
    const res = await fetch(this.tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`FCM auth failed with HTTP ${res.status}`);
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new Error("FCM auth returned no token");
    this.access = { token: j.access_token, until: now + (j.expires_in ?? 3600) * 1000 };
    return j.access_token;
  }

  async send(token: string, msg: PushMessage, opts: NativeSendOpts = {}): Promise<PushOutcome> {
    const body = {
      message: {
        token,
        notification: { title: msg.title, body: msg.body },
        data: appData(msg),
        android: {
          priority: opts.urgent ? "HIGH" : "NORMAL",
          collapse_key: msg.tag.slice(0, 64),
          notification: { channel_id: msg.channel, tag: msg.tag },
        },
      },
    };
    const res = await fetch(this.sendUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${await this.accessToken()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return "sent";
    // A token that no longer exists (app removed, data cleared) or belongs to another project.
    const err = (await res.json().catch(() => ({}))) as {
      error?: { status?: string; details?: { errorCode?: string }[] };
    };
    const codes = [err.error?.status, ...(err.error?.details ?? []).map((d) => d.errorCode)];
    if (res.status === 404 || codes.includes("UNREGISTERED") || codes.includes("SENDER_ID_MISMATCH")) return "gone";
    if (res.status === 401) this.access = null;
    console.error(`fcm push failed with HTTP ${res.status}${codes[0] ? ` (${codes[0]})` : ""}`);
    return "failed";
  }
}

// --- APNs --------------------------------------------------------------------------

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  /** The .p8 key, PEM text or base64 of it. */
  key: string;
  /** The app's bundle id. */
  topic: string;
  /** "production" for TestFlight and App Store builds, "sandbox" for builds from Xcode. */
  environment: "production" | "sandbox";
}

const APNS_HOSTS = { production: "https://api.push.apple.com", sandbox: "https://api.sandbox.push.apple.com" };

export function parseP8(raw: string): KeyObject {
  const text = raw.includes("BEGIN PRIVATE KEY") ? raw : Buffer.from(raw.trim(), "base64").toString("utf8");
  try {
    return createPrivateKey(text);
  } catch {
    throw new Error("APNs key is not a valid .p8 private key");
  }
}

export class ApnsSender implements NativeSender {
  readonly name = "apns";
  private readonly key: KeyObject;
  private readonly origin: string;
  private jwt: { token: string; at: number } | null = null;
  private session: ClientHttp2Session | null = null;
  private readonly now: () => number;

  constructor(
    private readonly cfg: ApnsConfig,
    opts: { origin?: string; now?: () => number } = {},
  ) {
    this.key = parseP8(cfg.key);
    this.origin = opts.origin ?? APNS_HOSTS[cfg.environment];
    this.now = opts.now ?? Date.now;
  }

  /** Apple wants a token that is at least 20 minutes and at most 60 minutes old. */
  private bearer(): string {
    const now = this.now();
    if (this.jwt && now - this.jwt.at < 40 * 60_000) return this.jwt.token;
    const token = signJwt(
      { alg: "ES256", kid: this.cfg.keyId },
      { iss: this.cfg.teamId, iat: Math.floor(now / 1000) },
      this.key,
      "ES256",
    );
    this.jwt = { token, at: now };
    return token;
  }

  private connection(): ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed) return this.session;
    const s = connect(this.origin);
    s.on("error", () => {});
    s.on("close", () => {
      if (this.session === s) this.session = null;
    });
    // Idle connections are closed by Apple after a while; do not keep the process alive for it.
    s.unref();
    this.session = s;
    return s;
  }

  send(token: string, msg: PushMessage, opts: NativeSendOpts = {}): Promise<PushOutcome> {
    if (!/^[0-9a-f]{64,200}$/i.test(token)) return Promise.resolve("gone");
    const payload = JSON.stringify({
      aps: { alert: { title: msg.title, body: msg.body }, "thread-id": msg.tag },
      ...appData(msg),
    });
    return new Promise<PushOutcome>((resolve) => {
      let req;
      try {
        req = this.connection().request({
          [constants.HTTP2_HEADER_METHOD]: "POST",
          [constants.HTTP2_HEADER_PATH]: `/3/device/${token}`,
          authorization: `bearer ${this.bearer()}`,
          "apns-topic": this.cfg.topic,
          "apns-push-type": "alert",
          "apns-priority": opts.urgent ? "10" : "5",
          "apns-collapse-id": msg.tag.slice(0, 64),
          "content-type": "application/json",
        });
      } catch (err) {
        console.error(`apns push failed: ${(err as Error).message}`);
        this.session = null;
        resolve("failed");
        return;
      }
      let status = 0;
      let data = "";
      req.setTimeout(15_000, () => req.close(constants.NGHTTP2_CANCEL));
      req.on("response", (h) => {
        status = Number(h[constants.HTTP2_HEADER_STATUS]);
      });
      req.setEncoding("utf8");
      req.on("data", (d: string) => {
        if (data.length < 2000) data += d;
      });
      req.on("error", (err) => {
        console.error(`apns push failed: ${err.message}`);
        resolve("failed");
      });
      req.on("close", () => {
        if (status === 200) return resolve("sent");
        let reason = "";
        try {
          reason = (JSON.parse(data) as { reason?: string }).reason ?? "";
        } catch {
          // no body
        }
        if (status === 410 || reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic" || reason === "Unregistered") {
          return resolve("gone");
        }
        if (reason === "ExpiredProviderToken") this.jwt = null;
        if (status) console.error(`apns push failed with HTTP ${status}${reason ? ` (${reason})` : ""}`);
        resolve("failed");
      });
      req.end(payload);
    });
  }

  close() {
    this.session?.close();
    this.session = null;
  }
}

/** The native senders the config asks for. Throws at start-up on broken credentials. */
export function nativeSendersFromConfig(cfg: {
  APPLE_APP_IDS: string;
  FCM_SERVICE_ACCOUNT_JSON?: string | undefined;
  APNS_KEY_P8?: string | undefined;
  APNS_KEY_ID?: string | undefined;
  APNS_TEAM_ID?: string | undefined;
  APNS_TOPIC?: string | undefined;
  APNS_ENVIRONMENT: "production" | "sandbox";
}): NativeSender[] {
  const senders: NativeSender[] = [];
  if (cfg.APNS_KEY_P8 && cfg.APNS_KEY_ID) {
    // "TEAMID.bundle.id": the first app the server associates with.
    const first = cfg.APPLE_APP_IDS.split(",")[0]?.trim() ?? "";
    const dot = first.indexOf(".");
    const teamId = cfg.APNS_TEAM_ID ?? (dot > 0 ? first.slice(0, dot) : "");
    const topic = cfg.APNS_TOPIC ?? (dot > 0 ? first.slice(dot + 1) : "");
    if (!teamId || !topic) throw new Error("APNs needs APNS_TEAM_ID and APNS_TOPIC (or an APPLE_APP_IDS entry)");
    senders.push(
      new ApnsSender({ keyId: cfg.APNS_KEY_ID, teamId, key: cfg.APNS_KEY_P8, topic, environment: cfg.APNS_ENVIRONMENT }),
    );
  }
  if (cfg.FCM_SERVICE_ACCOUNT_JSON) senders.push(new FcmSender(parseServiceAccount(cfg.FCM_SERVICE_ACCOUNT_JSON)));
  return senders;
}
