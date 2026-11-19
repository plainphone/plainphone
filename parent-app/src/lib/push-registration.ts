// SPDX-License-Identifier: Apache-2.0
import { ApiError, client, getSessionToken, unwrap } from "../api/client";
import { getItem, setItem } from "./storage";

const key = "pp.push-registration";
const installationStorageKey = "pp.push-installation";
type Registration = { id: string; token: string; platform: "apns" | "fcm" };
const pending = new Map<string, Promise<unknown>>();
let initializingInstallation: Promise<string> | undefined;
let signedOutSession: string | null = null;

async function saved(): Promise<Registration | null> {
  const raw = await getItem(key);
  return raw ? JSON.parse(raw) as Registration : null;
}

function serialize<T>(session: string, run: () => Promise<T>): Promise<T> {
  const operation = (pending.get(session) ?? Promise.resolve()).then(run);
  const settled = operation.catch(() => undefined);
  pending.set(session, settled);
  void settled.then(() => {
    if (pending.get(session) === settled) pending.delete(session);
  });
  return operation;
}

function getInstallationKey(seed: string): Promise<string> {
  return initializingInstallation ??= (async () => {
    const existing = await getItem(installationStorageKey);
    if (existing) return existing;
    // The first provider token is an opaque, installation-specific seed. Keep it across rotations and logins.
    await setItem(installationStorageKey, seed);
    return seed;
  })().finally(() => { initializingInstallation = undefined; });
}

function current(session: string) {
  return session === getSessionToken() && session !== signedOutSession;
}

export function registerNativeToken(platform: Registration["platform"], token: string, session: string, optIn = false) {
  return serialize(session, async () => {
    const prior = await saved();
    if (!current(session)) return false;
    const installationKey = await getInstallationKey(prior?.token ?? token);
    if (!current(session)) return false;
    try {
      const { id } = await unwrap<{ id: string }>(client.POST("/notifications/subscriptions", {
        body: { platform, token, installationKey, subscriptionId: prior?.id, optIn },
      }));
      if (!current(session)) return false;
      await setItem(key, JSON.stringify({ id, token, platform }));
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return false;
      throw error;
    }
  });
}

export async function logoutNativeSession() {
  const session = getSessionToken();
  if (!session) return;
  signedOutSession = session;
  // The server revokes every registration owned by this session, including POSTs whose response we never received.
  await unwrap(client.POST("/auth/logout"));
}
