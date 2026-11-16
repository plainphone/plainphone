// SPDX-License-Identifier: Apache-2.0
//
// Typed client for the Plainphone API, generated from server/openapi.yaml
// (`pnpm gen:api` writes src/api/schema.d.ts). Native apps authenticate with
// `Authorization: Bearer pp_s_…` and never send cookies.
import createClient, { type Middleware } from "openapi-fetch";
import { API_URL } from "../lib/config";
import type { paths } from "./schema";

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

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setSessionToken(t: string | null) {
  token = t;
}
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

const auth: Middleware = {
  onRequest({ request }) {
    if (token) request.headers.set("authorization", `Bearer ${token}`);
    request.headers.set("accept", "application/json");
    // The server refuses writes without a JSON content type (415), even with an empty body.
    if (request.method !== "GET" && !request.headers.has("content-type")) {
      request.headers.set("content-type", "application/json");
    }
    return request;
  },
};

export function makeClient(baseUrl = API_URL, fetchImpl?: typeof fetch) {
  const c = createClient<paths>({
    baseUrl,
    credentials: "omit",
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  c.use(auth);
  return c;
}

export const client = makeClient();

type Result = { data?: unknown; error?: unknown; response: Response };

/**
 * Unwraps an openapi-fetch result: returns the data, or throws ApiError.
 * Paths, parameters and request bodies are checked against the generated schema; many
 * responses are not described in openapi.yaml, so the caller names the response type:
 * `unwrap<Me>(client.GET("/me"))`.
 * A network failure becomes ApiError(0, "network"). A 401 outside /auth signs the app out.
 */
export async function unwrap<D = unknown>(p: Promise<Result>): Promise<D> {
  let r: Result;
  try {
    r = await p;
  } catch {
    throw new ApiError(0, "network");
  }
  if (!r.response.ok) {
    const e = (r.error ?? {}) as { error?: string; issues?: Issue[] };
    if (r.response.status === 401 && !new URL(r.response.url || "http://x/").pathname.includes("/auth/")) {
      onUnauthorized?.();
    }
    throw new ApiError(r.response.status, e.error ?? r.response.statusText ?? "error", e.issues ?? []);
  }
  return r.data as D;
}
