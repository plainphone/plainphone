// SPDX-License-Identifier: Apache-2.0
//
// Typed client for the Plainphone API, with the types @plainphone/api-client generates from
// server/openapi.yaml. Native apps authenticate with
// `Authorization: Bearer pp_s_…` and never send cookies.
import createClient, { type Middleware } from "openapi-fetch";
import { SERVER_URL } from "../lib/config";
import type { paths } from "@plainphone/api-client/schema";

export interface Issue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: Issue[] = [],
    /** The error body's other fields, e.g. the `outcome` of a request that was answered already. */
    readonly data: { outcome?: string; code?: string } = {},
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
let onUnauthorized: ((rejected: string | null) => void) | null = null;

export function setSessionToken(t: string | null) {
  token = t;
}
export function getSessionToken(): string | null {
  return token;
}
/** Called with the token the server refused, so a handler can ignore a token that was already replaced. */
export function setUnauthorizedHandler(fn: ((rejected: string | null) => void) | null) {
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
  onResponse({ request, response }) {
    if (response.status === 401 && !new URL(request.url).pathname.includes("/auth/")) {
      const sent = request.headers.get("authorization");
      onUnauthorized?.(sent?.startsWith("Bearer ") ? sent.slice(7) : null);
    }
    // Return nothing: openapi-fetch only accepts a returned `instanceof Response`, and
    // expo/fetch (the global fetch since Expo SDK 58) returns its own Response class.
  },
};

export function makeClient(baseUrl = `${SERVER_URL}/api`, fetchImpl?: typeof fetch) {
  const c = createClient<paths>({
    baseUrl,
    credentials: "omit",
    redirect: "error",
    // Late-bound, so tests can swap globalThis.fetch.
    fetch: fetchImpl ?? ((req: Request) => globalThis.fetch(req)),
  });
  c.use(auth);
  return c;
}

export let client = makeClient();

export function configureApiServer() {
  client = makeClient();
}

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
    const e = (r.error ?? {}) as { error?: string; issues?: Issue[]; outcome?: string; code?: string };
    throw new ApiError(r.response.status, e.error ?? r.response.statusText ?? "error", e.issues ?? [], e);
  }
  return r.data as D;
}
