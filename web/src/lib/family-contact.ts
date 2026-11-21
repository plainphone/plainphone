// SPDX-License-Identifier: Apache-2.0
//
// Client for an invited person's page (docs/extended-family.md). It is not the parent API: no
// cookies, only the bearer session this browser got when the person accepted.

import { ApiError } from "./api";

/**
 * The session of an extended family contact in this browser. It is a credential (it reads and
 * writes one conversation), so it stays in this one key and is removed on leave or a 401.
 */
export const CONTACT_SESSION_KEY = "pp.familyContact";

export function storedSession(): string | null {
  try {
    return localStorage.getItem(CONTACT_SESSION_KEY);
  } catch {
    return null;
  }
}
export function storeSession(session: string): void {
  try {
    localStorage.setItem(CONTACT_SESSION_KEY, session);
  } catch {
    // Private mode: the page still works until it is closed.
  }
}
export function clearSession(): void {
  try {
    localStorage.removeItem(CONTACT_SESSION_KEY);
  } catch {
    // ignore
  }
}

export async function contactRequest<T>(method: string, path: string, body?: unknown, session?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/family-contact${path}`, {
      method,
      credentials: "omit",
      headers: {
        accept: "application/json",
        ...(method !== "GET" ? { "content-type": "application/json" } : {}),
        ...(session ? { authorization: `Bearer ${session}` } : {}),
      },
      body: method !== "GET" ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    throw new ApiError(0, "network");
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) throw new ApiError(res.status, (json as { error?: string } | null)?.error ?? res.statusText);
  return (json ?? undefined) as T;
}

/** The invitation token from `#invite=…`, or null. */
export function inviteFromHash(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, "")).get("invite");
}
