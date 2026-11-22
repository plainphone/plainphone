// SPDX-License-Identifier: Apache-2.0
import { makeClient, unwrap } from "../src/api/client";

/**
 * Expo SDK 58 replaces globalThis.fetch with expo/fetch, whose FetchResponse implements
 * Response but does not inherit from the global Response class. openapi-fetch rejects a
 * middleware result that is not `instanceof Response`, so a middleware that hands the
 * native response back turns every call into a network error on a device.
 */
class ForeignResponse {
  constructor(private readonly inner: Response) {}
  get status() { return this.inner.status; }
  get ok() { return this.inner.ok; }
  get statusText() { return this.inner.statusText; }
  get headers() { return this.inner.headers; }
  get body() { return this.inner.body; }
  text() { return this.inner.text(); }
  json() { return this.inner.json(); }
}

const native = (body: unknown, status = 200) => async () =>
  new ForeignResponse(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as Response;

describe("API client on expo/fetch", () => {
  it("reads a response that is not an instance of the global Response", async () => {
    const c = makeClient("https://pp.example.org/api", native({ mailEnabled: true }, 202));
    await expect(unwrap(c.POST("/auth/request", { body: { email: "parent@example.org", locale: "en", client: "native" } })))
      .resolves.toEqual({ mailEnabled: true });
  });

  it("still reports server errors from such a response", async () => {
    const c = makeClient("https://pp.example.org/api", native({ error: "nope" }, 400));
    await expect(unwrap(c.POST("/auth/request", { body: { email: "parent@example.org", locale: "en", client: "native" } })))
      .rejects.toMatchObject({ status: 400, message: "nope" });
  });
});
