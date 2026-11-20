// SPDX-License-Identifier: Apache-2.0
//
// Logging out ends the session on the server, which also drops this device's push
// registrations. A logout the server never heard about (no network, or a switch to another
// server) leaves both valid there, so the device would keep getting the household's SOS and
// location alerts. The token is kept here and the logout is tried again until the server answers.
import { getItem, setItem } from "./storage";

const KEY = "pp.pendingLogout";

interface Pending {
  server: string;
  token: string;
}

async function load(): Promise<Pending[]> {
  try {
    const saved = JSON.parse((await getItem(KEY)) ?? "[]") as unknown;
    return Array.isArray(saved)
      ? saved.filter((p): p is Pending => typeof p?.server === "string" && typeof p?.token === "string")
      : [];
  } catch {
    return [];
  }
}

/** Ends the session on that server. True when it is gone there (ended now, or already unknown). */
export async function endSession(server: string, token: string): Promise<boolean> {
  try {
    const response = await fetch(`${server}/api/auth/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      credentials: "omit",
      redirect: "error",
    });
    return response.ok || response.status === 401;
  } catch {
    return false;
  }
}

export async function rememberLogout(server: string, token: string): Promise<void> {
  const pending = await load();
  if (pending.some((p) => p.server === server && p.token === token)) return;
  await setItem(KEY, JSON.stringify([...pending, { server, token }]));
}

/** Ends a session on its server now, and keeps trying later if the server can't be reached. */
export async function signOutOnServer(server: string, token: string): Promise<void> {
  if (!(await endSession(server, token))) await rememberLogout(server, token).catch(() => undefined);
}

let retrying: Promise<void> | null = null;

/** Tries every logout that did not reach its server; keeps the ones that still fail. */
export function retryPendingLogouts(): Promise<void> {
  retrying ??= (async () => {
    const pending = await load();
    if (!pending.length) return;
    const left: Pending[] = [];
    for (const p of pending) if (!(await endSession(p.server, p.token))) left.push(p);
    // Another logout may have been added meanwhile.
    const added = (await load()).filter((p) => !pending.some((q) => q.server === p.server && q.token === p.token));
    await setItem(KEY, JSON.stringify([...left, ...added]));
  })().catch(() => undefined).finally(() => {
    retrying = null;
  });
  return retrying;
}
