// SPDX-License-Identifier: Apache-2.0
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import type { DnsProvider } from "../providers/dns.js";
import type { MailProvider } from "../providers/mail.js";
import type { NativeParentPushProvider, ParentPushProvider } from "../providers/parent-push.js";
import type { PushProvider } from "../providers/push.js";
import type { RevocationList } from "./attestation.js";

export interface Ctx {
  db: Db;
  cfg: Config;
  mail: MailProvider;
  dns: DnsProvider;
  push: PushProvider;
  /** Notifications to parents (Web Push). */
  parentPush: ParentPushProvider;
  nativeParentPush?: NativeParentPushProvider;
  now: () => Date;
  /** Tests only: a fixed attestation challenge and revocation list. */
  attestation?: { challenge?: () => Buffer; revocations?: RevocationList };
}
