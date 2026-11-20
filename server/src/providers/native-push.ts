// SPDX-License-Identifier: Apache-2.0
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect } from "node:http2";
import { z } from "zod";
import type { Config } from "../config.js";
import type { ParentPushProvider, PushMessage, PushTarget, SendOutcome } from "./parent-push.js";

function jwt(header: object, claims: object, key: KeyObject, algorithm: string) {
  const data = [header, claims].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".");
  return data + "." + sign(algorithm, Buffer.from(data), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
}

const timeout = () => AbortSignal.timeout(5000);
const googleAuth = "https://oauth2.googleapis.com/token";
const credentials = z.object({ client_email: z.email(), private_key: z.string(), project_id: z.string().regex(/^[\w-]+$/) });

export class Fcm {
  private readonly account;
  private readonly key;
  private access?: { token: string; until: number };
  private refresh?: Promise<string>;

  constructor(json: string, private readonly http = fetch) {
    this.account = credentials.parse(JSON.parse(json));
    this.key = createPrivateKey(this.account.private_key);
  }

  get projectId() { return this.account.project_id; }

  private async authorize() {
    const iat = Math.floor(Date.now() / 1000);
    const assertion = jwt({ alg: "RS256" }, {
      iss: this.account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: googleAuth, iat, exp: iat + 3600,
    }, this.key, "RSA-SHA256");
    const response = await this.http(googleAuth, {
      method: "POST", signal: timeout(), redirect: "error",
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
    if (!response.ok) throw new Error("FCM authorization failed");
    const { access_token, expires_in } = z.object({ access_token: z.string(), expires_in: z.number() }).parse(await response.json());
    this.access = { token: access_token, until: Date.now() + (expires_in - 60) * 1000 };
    return access_token;
  }

  async send(message: object, validateOnly = false): Promise<SendOutcome> {
    try {
      const access = this.access;
      const token = access && access.until > Date.now()
        ? access.token
        : await (this.refresh ??= this.authorize().finally(() => { this.refresh = undefined; }));
      const response = await this.http(`https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`, {
        method: "POST", signal: timeout(), redirect: "error",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ message, ...(validateOnly && { validate_only: true }) }),
      });
      if (response.ok) return "sent";
      if (response.status === 401 && this.access?.token === token) this.access = undefined;
      const error = await response.json() as { error?: { details?: { "@type": string; errorCode?: string }[] } };
      return error.error?.details?.some((detail) =>
        detail["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError" &&
        ((response.status === 404 && detail.errorCode === "UNREGISTERED") ||
          (response.status === 403 && detail.errorCode === "SENDER_ID_MISMATCH") ||
          (response.status === 400 && detail.errorCode === "INVALID_ARGUMENT")))
        ? "gone" : "failed";
    } catch {
      return "failed";
    }
  }
}

type ApnsHttp = (origin: string, headers: Record<string, string>, payload: string) => Promise<{ status: number; body: string }>;
const apnsHttp: ApnsHttp = (origin, headers, payload) => new Promise((resolve, reject) => {
  const session = connect(origin);
  const timer = setTimeout(() => session.destroy(new Error("APNs timeout")), 5000);
  session.once("close", () => clearTimeout(timer));
  session.once("error", reject);
  const request = session.request({ ":method": "POST", ...headers });
  let status = 0;
  let body = "";
  request.setEncoding("utf8");
  request.on("response", (response) => { status = Number(response[":status"]); });
  request.on("data", (chunk: string) => { body += chunk; });
  request.on("error", (error) => { session.destroy(); reject(error); });
  request.on("end", () => { session.close(); resolve({ status, body }); });
  request.end(payload);
});

export class Apns {
  private readonly key;
  private auth?: { jwt: string; iat: number };
  constructor(
    p8: string, private readonly kid: string, private readonly team: string,
    private readonly topic: string, private readonly sandbox: boolean, private readonly http = apnsHttp,
  ) {
    this.key = createPrivateKey(p8);
  }

  async send(token: string, payload: object, urgent: boolean, collapseId?: string): Promise<SendOutcome> {
    const iat = Math.floor(Date.now() / 1000);
    if (!this.auth || iat - this.auth.iat >= 3000) {
      this.auth = { jwt: jwt({ alg: "ES256", kid: this.kid }, { iss: this.team, iat }, this.key, "SHA256"), iat };
    }
    try {
      const response = await this.http(this.sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com", {
        ":path": `/3/device/${encodeURIComponent(token)}`,
        authorization: `bearer ${this.auth.jwt}`,
        "apns-topic": this.topic, "apns-push-type": "alert", "apns-priority": urgent ? "10" : "5",
        "content-type": "application/json",
        // The same id replaces the notification already shown (the tag); APNs allows at most 64 bytes.
        ...(collapseId && Buffer.byteLength(collapseId) <= 64 && { "apns-collapse-id": collapseId }),
      }, JSON.stringify(payload));
      if (response.status === 200) return "sent";
      if (response.status === 410 || (response.status === 400 && ["BadDeviceToken", "DeviceTokenNotForTopic"].includes(JSON.parse(response.body).reason))) return "gone";
      return "failed";
    } catch {
      return "failed";
    }
  }
}

const base64 = /^[A-Za-z0-9+/_-]+={0,2}$/;

/** Decodes a strict base64 (or base64url) string, or returns undefined when it is not one. */
function decodeBase64(value: string) {
  const compact = value.replace(/\s+/g, "");
  return base64.test(compact) ? Buffer.from(compact, "base64").toString("utf8") : undefined;
}

/** Service-account JSON as raw JSON or base64 of it. Throws a message-free Error when it is neither. */
export function normalizeServiceAccount(value: string) {
  const trimmed = value.trim();
  const json = trimmed.startsWith("{") ? trimmed : decodeBase64(trimmed)?.trim();
  if (!json?.startsWith("{")) throw new Error("not JSON");
  return json;
}

/** An APNs `.p8` key as PEM text, PEM with literal `\n` escapes, or base64 of the PEM. */
export function normalizeApnsKey(value: string) {
  let pem = value.trim();
  if (!pem.includes("-----BEGIN")) pem = decodeBase64(pem)?.trim() ?? "";
  pem = pem.replace(/\\n/g, "\n");
  if (!pem.includes("-----BEGIN")) throw new Error("not PEM");
  return pem;
}

/**
 * FCM and APNs are optional: invalid settings switch that provider off and are reported as short
 * reasons in `errors`, never with the secret or the underlying error text.
 */
export function configureNativePush(cfg: Config) {
  const { FCM_SERVICE_ACCOUNT_JSON: inline, FCM_SERVICE_ACCOUNT_FILE: file, APNS_KEY_P8: p8,
    APNS_KEY_ID: kid, APNS_TEAM_ID: team, APNS_BUNDLE_ID: bundle, APNS_SANDBOX: sandbox } = cfg;
  const errors: string[] = [];
  const fail = (reason: string) => {
    errors.push(reason);
  };
  let fcm: Fcm | undefined;
  let apns: Apns | undefined;
  if (inline || file) {
    let raw: string | undefined;
    try {
      raw = inline || readFileSync(file!, "utf8");
    } catch {
      fail("fcm: service account file unreadable");
    }
    if (raw !== undefined) {
      try {
        fcm = new Fcm(normalizeServiceAccount(raw));
      } catch {
        fail("fcm: invalid service account");
      }
    }
  }
  if (p8 || kid || team) {
    if (!(p8 && kid && team)) {
      fail("apns: incomplete configuration");
    } else {
      try {
        apns = new Apns(normalizeApnsKey(p8), kid, team, bundle, sandbox === "true");
      } catch {
        fail("apns: invalid key");
      }
    }
  }
  return { fcm, apns, errors };
}

export class NativeParentPush implements ParentPushProvider {
  readonly name = "parent-push";
  constructor(private readonly web: ParentPushProvider, private readonly fcm?: Fcm, private readonly apns?: Apns) {}
  get webPublicKey() { return this.web.webPublicKey; }

  enabled(platform: PushTarget["platform"]) {
    return Boolean(platform === "web" ? this.webPublicKey : platform === "fcm" ? this.fcm : this.apns);
  }

  async send(target: PushTarget, { title, body, url, tag, data: extra, actions, silent }: PushMessage, opts?: { urgent?: boolean }): Promise<SendOutcome> {
    if (target.platform === "web") return this.web.send(target, { title, body, url, tag, actions, data: extra, silent }, opts);
    const urgent = Boolean(opts?.urgent);
    const data = {
      url, urgent: String(urgent),
      type: extra?.type ?? (url.endsWith("/location") ? "location" : url === "/approvals" ? "approval" : "phone"),
      ...(extra?.phoneId && { phoneId: extra.phoneId }),
      ...(extra?.requestId && { requestId: extra.requestId }),
      ...(extra?.phoneName && { phoneName: extra.phoneName }),
      // The parent app says "the phone will confirm" only when the phone sends receipts.
      ...(extra?.receipts === false && { receipts: "false" }),
    };
    // The parent app registers a notification category with this id, so the buttons exist without opening the app.
    const category = actions?.length ? extra?.type : undefined;
    if (target.platform === "apns") {
      return this.apns?.send(target.endpoint, {
        aps: { alert: { title, body }, ...(!silent && { sound: "default" }), ...(category && { category }), ...(urgent && { "interruption-level": "time-sensitive" }) },
        ...data,
      }, urgent, tag) ?? "unsupported";
    }
    // FCM "notification" messages are drawn by Android itself, without buttons. Messages with buttons are
    // data-only, so expo-notifications in the parent app draws them with the category's actions.
    if (category) {
      return this.fcm?.send({
        token: target.endpoint,
        data: { ...data, title, message: body, body: JSON.stringify(data), categoryId: category, channelId: "normal", tag },
        android: { priority: "HIGH" }, // an answer someone waits for; normal priority can sit in Doze
      }) ?? "unsupported";
    }
    return this.fcm?.send({
      token: target.endpoint, notification: { title, body }, data,
      android: { priority: urgent ? "HIGH" : "NORMAL", notification: { channel_id: urgent ? "sos" : silent ? "quiet" : "normal", tag } },
    }) ?? "unsupported";
  }
}
