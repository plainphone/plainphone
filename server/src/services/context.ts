// SPDX-License-Identifier: Apache-2.0
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import type { DnsProvider } from "../providers/dns.js";
import type { MailProvider } from "../providers/mail.js";
import type { ParentPushProvider } from "../providers/parent-push.js";
import type { PushProvider } from "../providers/push.js";

export interface Ctx {
  db: Db;
  cfg: Config;
  mail: MailProvider;
  dns: DnsProvider;
  push: PushProvider;
  /** Notifications to parents (Web Push). */
  parentPush: ParentPushProvider;
  now: () => Date;
}
