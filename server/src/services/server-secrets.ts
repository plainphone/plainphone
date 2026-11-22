// SPDX-License-Identifier: Apache-2.0
//
// Random keys the server makes for itself on first use and keeps in the database, so every
// process on the same database shares them and they survive restarts. Never logged or sent.

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { serverSecrets } from "../db/schema.js";
import type { Ctx } from "./context.js";

export type SecretName = "bot-challenge-hmac" | "rate-limit-hmac";

const cache = new WeakMap<Ctx, Map<SecretName, Promise<string>>>();

async function load(db: Ctx["db"], name: SecretName): Promise<string> {
  let [row] = await db.select({ value: serverSecrets.value }).from(serverSecrets).where(eq(serverSecrets.name, name));
  if (!row) {
    // Two processes starting at once: the first insert wins and both read it back.
    await db.insert(serverSecrets).values({ name, value: randomBytes(32).toString("base64url") }).onConflictDoNothing();
    [row] = await db.select({ value: serverSecrets.value }).from(serverSecrets).where(eq(serverSecrets.name, name));
  }
  return row!.value;
}

export function serverSecret(ctx: Ctx, name: SecretName): Promise<string> {
  const byName = cache.get(ctx) ?? new Map<SecretName, Promise<string>>();
  cache.set(ctx, byName);
  let secret = byName.get(name);
  if (!secret) {
    secret = load(ctx.db, name);
    byName.set(name, secret);
    // A failed read (database briefly down) is tried again on the next request.
    secret.catch(() => byName.delete(name));
  }
  return secret;
}
