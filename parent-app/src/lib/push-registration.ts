// SPDX-License-Identifier: Apache-2.0
import { ApiError, client, getSessionToken, unwrap } from "../api/client";
import { getItem, removeItem, setItem } from "./storage";

const key = "pp.push-registration";
type Registration = { id: string; token: string; platform: "apns" | "fcm" };
const pending = new Map<string, Promise<unknown>>();
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

export function registerNativeToken(platform: Registration["platform"], token: string, session: string, optIn = false) {
  return serialize(session, async () => {
    const prior = await saved();
    if (session !== getSessionToken() || session === signedOutSession) return false;
    const post = (subscriptionId?: string) => unwrap<{ id: string }>(client.POST("/notifications/subscriptions", {
      body: { platform, token, subscriptionId },
    }));
    try {
      const { id } = await post(prior?.id).catch((error: unknown) => {
        if (optIn && error instanceof ApiError && error.status === 404 && session === getSessionToken() &&
          session !== signedOutSession) return post();
        throw error;
      });
      if (session !== getSessionToken()) return false;
      await setItem(key, JSON.stringify({ id, token, platform }));
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return false;
      throw error;
    }
  });
}

export async function unregisterNativeToken(signingOut = false) {
  const session = getSessionToken();
  if (!session) return;
  if (signingOut) signedOutSession = session;
  // A permission check on an app that never registered has no work to queue.
  if (!signingOut && !pending.has(session) && !(await saved()) && !pending.has(session)) return;
  return serialize(session, async () => {
    const prior = await saved();
    if (!prior || session !== getSessionToken()) return;
    await unwrap(client.DELETE("/notifications/subscriptions/{sid}", { params: { path: { sid: prior.id } } }));
    if (signingOut) await removeItem(key);
  });
}
