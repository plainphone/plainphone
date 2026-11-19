// SPDX-License-Identifier: Apache-2.0
import Constants from "expo-constants";
import { getItem, setItem } from "./storage";

export const HOSTED_SERVER = "https://app.plainphone.org";
const SERVER_KEY = "pp.server";
export const BUILD_SERVER = ((Constants.expoConfig?.extra?.serverUrl as string | undefined) ?? HOSTED_SERVER).replace(/\/+$/, "");
export let SERVER_URL = BUILD_SERVER;

export function normalizeServerUrl(input: string, dev = __DEV__): string {
  const raw = input.trim();
  // Restrict runtime settings to origins, as setup links and APIs use absolute paths.
  if (!/^https?:\/\/[^\s/?#@\\]+\/?$/i.test(raw)) throw new Error("Invalid server address");
  const url = new URL(raw);
  if (url.port === "0") throw new Error("Invalid server port");
  const host = url.hostname;
  const local = host === "localhost" || host === "[::1]" || host.endsWith(".local") ||
    /^(?:(?:127|10)\.\d+|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d+\.\d+$/.test(host);
  if (url.protocol !== "https:" && !(dev && local)) throw new Error("HTTPS required");
  return url.origin;
}

export async function checkServer(server: string, fetchImpl = globalThis.fetch): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const url = `${server}/api/health`;
    const response = await fetchImpl(url, { credentials: "omit", redirect: "error", signal: controller.signal });
    if (!response.ok || response.redirected || (response.url && response.url !== url)) throw new Error("Server unavailable");
    const status = await response.json();
    if (status?.ok !== true || status?.compatibility !== 1) throw new Error("Incompatible server");
  } finally {
    clearTimeout(timeout);
  }
}

export async function restoreServer() {
  const saved = await getItem(SERVER_KEY);
  SERVER_URL = saved === null ? BUILD_SERVER : normalizeServerUrl(saved);
}

export async function saveServer(server: string) {
  await setItem(SERVER_KEY, server);
  SERVER_URL = server;
}
