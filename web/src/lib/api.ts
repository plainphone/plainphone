// SPDX-License-Identifier: Apache-2.0
//
// Thin client for the parent API. The session lives in an HttpOnly cookie (path /api),
// so the app never sees or stores a token.

export type Locale = "en" | "da";
export type Profile = "child" | "self";
export type DnsCategory = "social" | "adult" | "gambling" | "games" | "dating" | "video";
export const DNS_CATEGORIES: DnsCategory[] = ["social", "adult", "gambling", "games", "dating", "video"];

export interface User {
  id: string;
  email: string;
  locale: string;
}
export interface Me {
  user: User;
  households: { id: string; name: string; role: "owner" | "parent" }[];
  mailEnabled: boolean;
}
export interface Phone {
  id: string;
  name: string;
  profile: Profile;
  mode: "strong" | "light";
  timezone: string;
  locationEnabled: boolean;
  pairedAt: string | null;
  lastSeenAt: string | null;
  dnsHost: string;
  dnsSynced: boolean;
  hasLocation: boolean;
}
export interface App {
  packageName: string;
  label: string;
  allowed: boolean;
  core: boolean;
}
export interface Contact {
  id: string;
  name: string;
  number: string;
}
export interface DnsState {
  host: string;
  synced: boolean;
  blockedCategories: DnsCategory[];
  allowDomains: string[];
  blockDomains: string[];
}
export type ScheduleKind = "school" | "bedtime";
export interface ScheduleInput {
  kind: ScheduleKind;
  days: number[];
  startMinute: number;
  endMinute: number;
  allowedPackages: string[];
}
export interface Schedule extends ScheduleInput {
  id: string;
}
export interface LocationState {
  enabled: boolean;
  requestedAt: string | null;
  location: { lat: number; lon: number; accuracyM: number | null; recordedAt: string } | null;
}
export interface KeyInput {
  keyType: "delay" | "trusted";
  delayHours: number;
  trustedEmail: string | null;
  payUnlockEnabled: boolean;
  payUnlockAmount: number;
  payUnlockRecipient: "plainphone";
}
export interface SelfKey extends KeyInput {
  trustedAccepted: boolean;
  payUnlockCurrency: string;
}

export type Op =
  | { type: "app.set"; packageName: string; allowed: boolean }
  | { type: "contact.add"; name: string; number: string }
  | { type: "contact.remove"; contactId: string }
  | { type: "dns.category"; category: DnsCategory; blocked: boolean }
  | { type: "dns.allowDomain"; domain: string; present: boolean }
  | { type: "dns.blockDomain"; domain: string; present: boolean }
  | { type: "schedule.create"; schedule: ScheduleInput }
  | { type: "schedule.update"; scheduleId: string; schedule: ScheduleInput }
  | { type: "schedule.delete"; scheduleId: string }
  | { type: "key.set"; key: KeyInput };

export interface PendingChange {
  id: string;
  op: Op;
  keyType: "delay" | "trusted";
  effectiveAt: string | null;
  createdAt?: string;
}
export type ChangeResult = { status: "applied" } | { status: "pending"; change: PendingChange };

export interface Approval {
  id: string;
  phoneName: string;
  requestedBy: string | null;
  op: Op;
  /** The app's name for app.set ops, when the phone has reported it. */
  appLabel: string | null;
  createdAt: string;
}
export interface Members {
  members: { id: string; email: string; role: "owner" | "parent" }[];
  invites: { id: string; email: string; expiresAt: string }[];
}
export interface InviteResult {
  id: string;
  email: string;
  expiresAt: string;
  mailed: boolean;
  url?: string;
}

export interface Issue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: Issue[] = [],
  ) {
    super(message);
  }
  /** Field errors keyed by path, e.g. { number: "use international format..." }. */
  fields(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const i of this.issues) out[i.path] ??= i.message;
    return out;
  }
}

/** Called when any request comes back 401, so the app can show the login page. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        // The server refuses writes without this (415), even with an empty body.
        ...(method !== "GET" ? { "content-type": "application/json" } : {}),
      },
      body: method !== "GET" ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    throw new ApiError(0, "network");
  }
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    const j = (json ?? {}) as { error?: string; issues?: Issue[] };
    if (res.status === 401 && !path.startsWith("/auth/")) onUnauthorized?.();
    throw new ApiError(res.status, j.error ?? res.statusText, j.issues ?? []);
  }
  if (res.status === 202 || res.status === 200 || res.status === 201) {
    // Change endpoints answer 200 {status:"applied"} or 202 {status:"pending"}.
    return json as T;
  }
  return undefined as T;
}

export const api = {
  get: <T>(p: string) => request<T>("GET", p),
  post: <T>(p: string, b?: unknown) => request<T>("POST", p, b),
  put: <T>(p: string, b?: unknown) => request<T>("PUT", p, b),
  patch: <T>(p: string, b?: unknown) => request<T>("PATCH", p, b),
  del: <T>(p: string) => request<T>("DELETE", p),
};

/** Mail is configured on this server. Works without a session via /api/health. */
export async function serverHasMail(): Promise<boolean | null> {
  try {
    const res = await fetch("/api/health", { credentials: "same-origin" });
    const j = (await res.json()) as { mail?: string };
    return j.mail ? j.mail !== "none" : null;
  } catch {
    return null;
  }
}
