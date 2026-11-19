// SPDX-License-Identifier: Apache-2.0
import type { Config } from "../config.js";
import { validVapidKeys } from "../lib/webpush.js";
import { LogMailProvider, NoMailProvider, SmtpMailProvider, type MailProvider } from "../providers/mail.js";
import { configureNativePush, NativeParentPush } from "../providers/native-push.js";
import { NoParentPushProvider, WebPushProvider } from "../providers/parent-push.js";
import { PhonePushProvider } from "../providers/push.js";
import type { Ctx } from "./context.js";

/**
 * Builds the optional integrations (mail, Web Push, FCM, APNs). Invalid settings never stop the
 * server: the integration is switched off, one line is logged (name and reason, never the value
 * or the underlying error text) and the reason is reported by /api/health. Required settings,
 * such as the database, stay fail-fast in loadConfig and main.
 */
export function buildOptionalProviders(cfg: Config): Pick<Ctx, "mail" | "push" | "parentPush" | "degraded"> {
  const degraded = { push: [] as string[], other: [] as string[] };
  const fail = (list: string[], reason: string) => {
    list.push(reason);
    console.error(`integration disabled: ${reason}`);
  };

  const { fcm, apns, errors } = configureNativePush(cfg);
  degraded.push.push(...errors);

  let vapid: { publicKey: string; privateKey: string } | null = null;
  if (cfg.VAPID_PUBLIC_KEY || cfg.VAPID_PRIVATE_KEY) {
    if (!cfg.VAPID_PUBLIC_KEY || !cfg.VAPID_PRIVATE_KEY) {
      fail(degraded.push, "web: needs both VAPID keys");
    } else if (!validVapidKeys({ publicKey: cfg.VAPID_PUBLIC_KEY, privateKey: cfg.VAPID_PRIVATE_KEY })) {
      fail(degraded.push, "web: invalid VAPID key pair");
    } else {
      vapid = { publicKey: cfg.VAPID_PUBLIC_KEY, privateKey: cfg.VAPID_PRIVATE_KEY };
    }
  }

  let mail: MailProvider;
  if (cfg.MAIL_PROVIDER === "smtp") {
    try {
      if (!cfg.SMTP_URL) throw new Error("missing");
      mail = new SmtpMailProvider(cfg.SMTP_URL, cfg.MAIL_FROM);
    } catch {
      fail(degraded.other, "smtp: invalid or missing SMTP_URL");
      mail = new NoMailProvider();
    }
  } else {
    mail = cfg.MAIL_PROVIDER === "log" ? new LogMailProvider() : new NoMailProvider();
  }

  let parentWeb;
  try {
    parentWeb = vapid ? new WebPushProvider(vapid, cfg.VAPID_SUBJECT) : new NoParentPushProvider();
  } catch {
    fail(degraded.push, "web: invalid VAPID settings");
    parentWeb = new NoParentPushProvider();
  }

  return {
    mail,
    push: new PhonePushProvider(cfg, fcm),
    parentPush: new NativeParentPush(parentWeb, fcm, apns),
    degraded,
  };
}
