// SPDX-License-Identifier: Apache-2.0
//
// The phone side of the sync API (docs/sync-api.md) for the Child role on an iPhone. Separate from
// the parent client in src/api/client.ts: it sends the device token, never the parent's session,
// so the two can never mix on one iPhone.
import type { components } from "../../api/schema";
import { getItem, removeItem, setItem } from "../storage";

export type IosStatus = components["schemas"]["IosStatus"];

export interface DeviceIdentity {
  phoneId: string;
  deviceToken: string;
  /** The server this phone paired with, without a trailing slash. */
  server: string;
}

const IDENTITY_KEY = "pp.device";

export async function loadIdentity(): Promise<DeviceIdentity | null> {
  const raw = await getItem(IDENTITY_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<DeviceIdentity>;
    return v.phoneId && v.deviceToken && v.server ? { phoneId: v.phoneId, deviceToken: v.deviceToken, server: v.server } : null;
  } catch {
    return null;
  }
}

export async function saveIdentity(identity: DeviceIdentity): Promise<void> {
  await setItem(IDENTITY_KEY, JSON.stringify(identity));
}

export async function clearIdentity(): Promise<void> {
  await removeItem(IDENTITY_KEY);
}

export interface DeviceResponse {
  status: number;
  etag: string | null;
  text: string;
  json<T = Record<string, unknown>>(): T;
}

/** One request to `/api/device/*`. Network errors throw; HTTP errors come back as a status. */
export type DeviceFetch = (method: string, path: string, opts?: { token?: string; body?: unknown; headers?: Record<string, string> }) => Promise<DeviceResponse>;

export function deviceFetch(server: string, fetchImpl: typeof fetch = (req, init) => globalThis.fetch(req, init)): DeviceFetch {
  return async (method, path, opts = {}) => {
    const headers: Record<string, string> = { accept: "application/json", ...opts.headers };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (method !== "GET") headers["content-type"] = "application/json";
    const res = await fetchImpl(`${server}/api/device${path}`, {
      method,
      headers,
      body: opts.body === undefined ? (method === "GET" ? undefined : "{}") : JSON.stringify(opts.body),
      credentials: "omit",
      redirect: "error",
    });
    const text = res.status === 204 || res.status === 304 ? "" : await res.text();
    return {
      status: res.status,
      etag: res.headers.get("etag"),
      text,
      json: <T,>() => (text ? JSON.parse(text) : {}) as T,
    };
  };
}
