// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { ApiError, createClient, type ApiPath } from "../src/index";

function reply(status: number, body?: unknown) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, statusText: `status ${status}` }),
  );
}

describe("createClient", () => {
  it("sends a GET with the cookie and no body, and returns the JSON", async () => {
    const fetch = reply(200, { ok: true });
    const { api } = createClient({ baseUrl: "/api", credentials: "same-origin", fetch });
    await expect(api.get<{ ok: boolean }>("/me")).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith("/api/me", {
      method: "GET",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      body: undefined,
    });
  });

  it("sends writes as JSON, an empty object when there is no body", async () => {
    const fetch = reply(202, { status: "pending" });
    const { api } = createClient({ baseUrl: "/api", credentials: "same-origin", fetch });
    await expect(api.post("/changes/c1/approve")).resolves.toEqual({ status: "pending" });
    expect(fetch).toHaveBeenCalledWith("/api/changes/c1/approve", {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: "{}",
    });
    await api.put("/phones/p1/settings/wifi", { mode: "locked", value: "on" });
    expect(fetch.mock.calls[1]![1]!.body).toBe('{"mode":"locked","value":"on"}');
  });

  it("adds the caller's headers, and leaves credentials out when not set", async () => {
    const fetch = reply(200, {});
    const { api } = createClient({ baseUrl: "https://example.org/api", headers: () => ({ authorization: "Bearer t" }), fetch });
    await api.del("/phones/p1/modes/m1");
    expect(fetch).toHaveBeenCalledWith("https://example.org/api/phones/p1/modes/m1", {
      method: "DELETE",
      headers: { authorization: "Bearer t", accept: "application/json", "content-type": "application/json" },
      body: "{}",
    });
  });

  it("answers undefined for a reply without a body (204)", async () => {
    const { api } = createClient({ baseUrl: "/api", fetch: reply(204) });
    await expect(api.del("/phones/p1/modes/m1")).resolves.toBeUndefined();
  });

  it("throws ApiError with the error body, and reports a 401 outside /auth/", async () => {
    const onUnauthorized = vi.fn();
    const body = { error: "invalid", issues: [{ path: "number", message: "bad" }], selfPhoneIds: ["p2"] };
    const { api } = createClient({ baseUrl: "/api", fetch: reply(401, body), onUnauthorized });
    const err = await api.get("/me").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, message: "invalid", issues: body.issues, data: body });
    expect((err as ApiError).fields()).toEqual({ number: "bad" });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await api.post("/auth/verify", {}).catch(() => undefined);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("uses the status text when the error has no JSON body", async () => {
    const fetch = vi.fn(async () => new Response("<html>", { status: 502, statusText: "Bad Gateway" }));
    const { api } = createClient({ baseUrl: "/api", fetch });
    await expect(api.get("/me")).rejects.toMatchObject({ status: 502, message: "Bad Gateway", issues: [] });
  });

  it("turns a failed fetch into ApiError(0, network)", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("offline");
    });
    const { api } = createClient({ baseUrl: "/api", fetch });
    await expect(api.get("/me")).rejects.toMatchObject({ status: 0, message: "network" });
  });

  it("looks up the global fetch on each call", async () => {
    const { api } = createClient({ baseUrl: "/api" });
    const fetch = reply(200, { n: 1 });
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(api.get("/me")).resolves.toEqual({ n: 1 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// Compile-time checks: `pnpm typecheck` fails if these stop holding.
const pid = "p1" as string;
export const typed: ApiPath<"get">[] = [`/phones/${pid}/settings`, `/phones/${pid}/sos?unseen=1`, "/me"];
// @ts-expect-error not a route in server/openapi.yaml
export const unknownRoute: ApiPath<"get"> = "/no-such-route";
// @ts-expect-error the spec has no GET for this route
export const wrongMethod: ApiPath<"get"> = "/auth/verify";
