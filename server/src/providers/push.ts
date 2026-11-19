// SPDX-License-Identifier: Apache-2.0
import type { Config } from "../config.js";
import type { Fcm } from "./native-push.js";
import { pushHostAllowed } from "./parent-push.js";

export const WAKE_PROVIDERS = ["none", "fcm", "unifiedpush"] as const;
export type WakeTransport = (typeof WAKE_PROVIDERS)[number];
export type WakeReason = "rules" | "locate" | "update" | "sos-ack";

/** Push only shortens the delay. The payload has no authority to apply rules. */
export interface PushProvider {
  readonly name: string;
  readonly fcmAvailable?: boolean;
  readonly fcmProject?: string;
  readonly unifiedPushAvailable?: boolean;
  acceptsEndpoint?(endpoint: string): boolean;
  validateFcmToken?(token: string): ReturnType<Fcm["send"]>;
  wake(token: string, reason: WakeReason, transport?: WakeTransport): Promise<void | "gone">;
}

/** Bump the version when validation semantics change. The project ID is public Firebase metadata. */
export function fcmValidationKey(push: PushProvider) {
  return push.validateFcmToken ? `v1:${push.fcmProject ?? ""}` : null;
}

export class NoPushProvider implements PushProvider {
  readonly name = "none";
  async wake() {}
}

export class PhonePushProvider implements PushProvider {
  private readonly hosts: string[];
  constructor(private readonly cfg: Config, private readonly fcm?: Fcm, private readonly http = fetch) {
    this.hosts = cfg.PUSH_EXTRA_HOSTS.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  }
  get name() { return this.cfg.PUSH_PROVIDER; }
  get fcmProject() { return this.fcm?.projectId; }
  get fcmAvailable() { return this.name === "fcm" && Boolean(this.fcm); }
  get unifiedPushAvailable() { return this.name !== "none" && this.hosts.length > 0; }
  acceptsEndpoint(endpoint: string) {
    return this.unifiedPushAvailable && pushHostAllowed(endpoint, this.hosts) && !new URL(endpoint).hash;
  }
  validateFcmToken(token: string) {
    return this.fcm?.send({ token, data: { wake: "rules" } }, true) ?? Promise.resolve("unsupported" as const);
  }
  async wake(token: string, reason: WakeReason, transport: WakeTransport = "fcm"): Promise<void | "gone"> {
    if (transport === "fcm" && this.fcmAvailable) {
      if (await this.fcm!.send({
        token, data: { wake: reason }, android: { priority: "HIGH", ttl: "60s", collapse_key: "plainphone-sync" },
      }) === "gone") return "gone";
    }
    if (transport === "unifiedpush" && this.acceptsEndpoint(token)) {
      const response = await this.http(token, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
        headers: { "content-type": "text/plain", ttl: "60", urgency: "high", "x-unifiedpush": "1", "x-cache": "no" },
        body: JSON.stringify({ wake: reason }),
      });
      await response.body?.cancel();
      if (response.status === 404 || response.status === 410) return "gone";
    }
  }
}

/** Records wake-ups. Used in tests. */
export class RecordingPushProvider implements PushProvider {
  readonly name = "recording";
  readonly fcmAvailable = true;
  readonly sent: { token: string; reason: string }[] = [];
  async wake(token: string, reason: WakeReason) {
    this.sent.push({ token, reason });
  }
}
