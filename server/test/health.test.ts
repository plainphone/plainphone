// SPDX-License-Identifier: Apache-2.0
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { HttpDnsProvider } from "../src/providers/dns.js";
import { PUBLIC_URL, useHarness } from "./harness.js";

const h = useHarness();

/** A stand-in for ppdns' /healthz that can be switched off. */
let up = true;
let url = "";
const ppdns = createServer((req, res) => {
  res.writeHead(req.url === "/healthz" && up ? 200 : 503).end();
});
beforeAll(async () => {
  await new Promise<void>((r) => ppdns.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(ppdns.address() as AddressInfo).port}/`;
});
afterAll(() => new Promise<void>((r) => ppdns.close(() => r())));

async function health(dnsProvider: "mock" | "http") {
  const cfg = loadConfig({
    DATABASE_URL: "unused",
    PUBLIC_URL,
    NODE_ENV: "test",
    DNS_PROVIDER: dnsProvider,
    DNS_API_URL: url,
    DNS_API_TOKEN: "secret",
  });
  const dns = dnsProvider === "http" ? new HttpDnsProvider(url, "secret") : h.dns;
  const app = createApp({ ...h.ctx, cfg, dns });
  const res = await app.request("/api/health");
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("/api/health", () => {
  it("says mock when no DNS service is configured", async () => {
    expect(await health("mock")).toEqual({ status: 200, json: { ok: true, db: "ok", mail: "memory", dns: "mock" } });
  });

  it("reports whether the DNS service answers", async () => {
    up = true;
    expect((await health("http")).json.dns).toBe("ok");
    up = false;
    const down = await health("http");
    // A DNS outage is visible, but the server itself stays healthy.
    expect(down).toMatchObject({ status: 200, json: { ok: true, dns: "down" } });
    up = true;
  });
});
