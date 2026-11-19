// SPDX-License-Identifier: Apache-2.0
import { client, getSessionToken, unwrap } from "../api/client";
import { getItem, removeItem, setItem } from "./storage";

const key = "pp.push-registration";
type Registration = { id: string; token: string; platform: "apns" | "fcm" };
let pending: Promise<unknown> = Promise.resolve();
let signedOutSession: string | null = null;

async function saved(): Promise<Registration | null> {
  try {
    const raw = await getItem(key);
    return raw ? JSON.parse(raw) as Registration : null;
  } catch {
    return null;
  }
}

export function registerNativeToken(platform: Registration["platform"], token: string, session: string) {
  const operation = pending.then(async () => {
    const prior = await saved();
    if (session !== getSessionToken() || session === signedOutSession) return;
    const { id } = await unwrap<{ id: string }>(client.POST("/notifications/subscriptions", {
      body: { platform, token, replaces: prior?.platform === platform ? prior.token : undefined },
    }));
    if (session === signedOutSession && session === getSessionToken()) {
      await unwrap(client.DELETE("/notifications/subscriptions/{sid}", { params: { path: { sid: id } } }));
      return;
    }
    await setItem(key, JSON.stringify({ id, token, platform }));
  });
  pending = operation.catch(() => undefined);
  return operation;
}

export async function unregisterNativeToken(signingOut = false) {
  const session = getSessionToken();
  if (signingOut) signedOutSession = session;
  const prior = await saved();
  if (!prior || !session || session !== getSessionToken()) return;
  await unwrap(client.DELETE("/notifications/subscriptions/{sid}", { params: { path: { sid: prior.id } } }));
  await removeItem(key);
}
