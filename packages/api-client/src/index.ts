// SPDX-License-Identifier: Apache-2.0
//
// Typed access to the Plainphone API for the web dashboard and the parent app.
// src/schema.d.ts is generated from server/openapi.yaml (`pnpm --filter @plainphone/api-client
// generate`); CI fails when it is out of date. The paths each method accepts come from that
// schema, so a call to a route the spec does not describe does not compile. Response bodies are
// not all described in the spec yet, so the caller still names the response type:
// `api.get<Me>("/me")`.
import type { paths } from "./schema";

export type { components, operations, paths } from "./schema";

export type Method = "get" | "post" | "put" | "patch" | "delete";

/** Spec paths with an operation for `M` (the generator writes `put?: never` for a missing one). */
export type SpecPath<M extends Method> = {
  [P in keyof paths & string]: paths[P] extends { [K in M]: unknown } ? P : never;
}[keyof paths & string];

/** "/phones/{pid}/settings" becomes `/phones/${string}/settings`. */
type Concrete<P extends string> = P extends `${infer Head}{${string}}${infer Tail}` ? `${Head}${string}${Concrete<Tail>}` : P;

/** A concrete path for `M`, optionally with a query string: `/phones/${pid}/events?since=…`. */
export type ApiPath<M extends Method> = Concrete<SpecPath<M>> | `${Concrete<SpecPath<M>>}?${string}`;

export interface Issue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: Issue[] = [],
    /** The whole error body, for endpoints that explain more (e.g. selfPhoneIds). */
    readonly data: { selfPhoneIds?: string[]; outcome?: string; code?: string; error?: string; limit?: string; max?: number } = {},
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

export interface ClientOptions {
  /** Put in front of every path: "/api" in the PWA, `${server}/api` in a native app. */
  baseUrl: string;
  /** "same-origin" in the PWA (the session is an HttpOnly cookie); "omit" for bearer tokens. */
  credentials?: RequestCredentials;
  /** Extra headers for each request, for example `authorization` in a native app. */
  headers?: () => Record<string, string>;
  /** Called when a request outside /auth/ comes back 401, so the app can show the login page. */
  onUnauthorized?: () => void;
  /** Defaults to the global fetch, looked up on every call so tests can replace it. */
  fetch?: typeof fetch;
}

export function createClient(options: ClientOptions) {
  /** Any path, typed or not. Use it directly only for a route the spec does not describe. */
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await (options.fetch ?? fetch)(`${options.baseUrl}${path}`, {
        method,
        ...(options.credentials ? { credentials: options.credentials } : {}),
        headers: {
          ...options.headers?.(),
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
      const j = (json ?? {}) as { error?: string; issues?: Issue[]; selfPhoneIds?: string[]; outcome?: string; code?: string; limit?: string; max?: number };
      if (res.status === 401 && !path.startsWith("/auth/")) options.onUnauthorized?.();
      throw new ApiError(res.status, j.error ?? res.statusText, j.issues ?? [], j);
    }
    if (res.status === 202 || res.status === 200 || res.status === 201) {
      // Change endpoints answer 200 {status:"applied"} or 202 {status:"pending"}.
      return json as T;
    }
    return undefined as T;
  }

  /** Requests whose path must be a route in server/openapi.yaml for that method. */
  const api = {
    get: <T>(p: ApiPath<"get">) => request<T>("GET", p),
    post: <T>(p: ApiPath<"post">, b?: unknown) => request<T>("POST", p, b),
    put: <T>(p: ApiPath<"put">, b?: unknown) => request<T>("PUT", p, b),
    patch: <T>(p: ApiPath<"patch">, b?: unknown) => request<T>("PATCH", p, b),
    del: <T>(p: ApiPath<"delete">, b?: unknown) => request<T>("DELETE", p, b),
  };

  return { request, api };
}
