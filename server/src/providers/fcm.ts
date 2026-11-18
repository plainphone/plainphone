// SPDX-License-Identifier: Apache-2.0
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { z } from "zod";
import type { NativeParentPushProvider, NativePushMessage, SendOutcome } from "./parent-push.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const accountSchema = z.object({
  project_id: z.string().regex(/^[a-z0-9-]+$/),
  client_email: z.email(),
  private_key: z.string(),
});
const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() });
const errorSchema = z.object({
  error: z.object({ details: z.array(z.object({ "@type": z.string(), errorCode: z.string() })).optional() }),
});

class FcmProvider implements NativeParentPushProvider {
  readonly platform = "fcm";
  private accessToken?: { value: string; refreshAt: number };
  private refreshing?: Promise<string>;

  constructor(
    private readonly account: z.infer<typeof accountSchema>,
    private readonly key: KeyObject,
    private readonly fetchImpl: typeof fetch,
  ) {}

  private getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessToken.refreshAt) return Promise.resolve(this.accessToken.value);
    this.refreshing ??= this.exchangeToken().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  private async exchangeToken(): Promise<string> {
    const started = Date.now();
    const iat = Math.floor(started / 1000);
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const claims = encode({ iss: this.account.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 });
    const jwt = `${encode({ alg: "RS256", typ: "JWT" })}.${claims}`;
    const signature = sign("RSA-SHA256", Buffer.from(jwt), this.key).toString("base64url");
    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${jwt}.${signature}`,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("FCM OAuth token exchange failed");
    }
    const token = tokenSchema.parse(await response.json());
    this.accessToken = { value: token.access_token, refreshAt: started + (token.expires_in - 60) * 1000 };
    return token.access_token;
  }

  async send(token: string, message: NativePushMessage): Promise<SendOutcome> {
    try {
      const accessToken = await this.getAccessToken();
      const { title, body, type } = message;
      const response = await this.fetchImpl(`https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          message: { token, notification: { title, body }, data: { type }, android: { notification: { channel_id: "approval" } } },
        }),
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      const result = await response.json().catch(() => null);
      if (response.ok) return "sent";
      // A project or URL can also return 404. Only FCM's token-specific error proves it is gone.
      const error = errorSchema.safeParse(result);
      if (response.status === 404 && error.success && error.data.error.details?.some((detail) =>
        detail["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError" && detail.errorCode === "UNREGISTERED",
      )) return "gone";
      if (response.status === 401 && this.accessToken?.value === accessToken) this.accessToken = undefined;
      console.error(`FCM send failed with HTTP ${response.status}`);
    } catch {
      console.error("FCM token exchange or send failed");
    }
    return "failed";
  }
}

export function createFcmProvider(raw: string | undefined, fetchImpl: typeof fetch = fetch): NativeParentPushProvider | undefined {
  const value = raw?.trim();
  if (!value) {
    console.warn("FCM parent push is disabled because FCM_SERVICE_ACCOUNT_JSON is unset");
    return undefined;
  }
  try {
    const json = value.startsWith("{") ? value : Buffer.from(value, "base64").toString("utf8");
    const account = accountSchema.parse(JSON.parse(json));
    const key = createPrivateKey(account.private_key);
    if (key.asymmetricKeyType !== "rsa") throw new Error("expected an RSA private key");
    return new FcmProvider(account, key, fetchImpl);
  } catch {
    throw new Error("FCM_SERVICE_ACCOUNT_JSON must contain a valid service-account JSON with an RSA key");
  }
}
