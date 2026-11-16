// SPDX-License-Identifier: Apache-2.0
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpDnsProvider } from "../src/providers/dns.js";

/** A stand-in for the DNS service's /v1/clients API (dns/ppdns/server.py). */
const clients = new Map<string, Record<string, unknown>>();
const seen: string[] = [];
let url = "";
const server = createServer(async (req: IncomingMessage, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  seen.push(`${req.method} ${req.url}`);
  const send = (status: number, json?: unknown) => {
    res.writeHead(status, json ? { "content-type": "application/json" } : {});
    res.end(json ? JSON.stringify(json) : undefined);
  };
  if (req.headers.authorization !== "Bearer secret") return send(401, { error: "token" });
  const m = /^\/v1\/clients(?:\/([^/]+))?$/.exec(req.url ?? "");
  if (!m) return send(404, { error: "not found" });
  const id = m[1];
  if (req.method === "POST" && !id) {
    clients.set(body.client_id, body);
    return send(201, body);
  }
  if (!id || !clients.has(id)) return send(404, { error: "no such client" });
  if (req.method === "PATCH") {
    clients.set(id, { ...clients.get(id), ...body });
    return send(200, clients.get(id));
  }
  if (req.method === "DELETE") {
    clients.delete(id);
    return send(204);
  }
  send(404, { error: "not found" });
});

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("HttpDnsProvider", () => {
  it("creates on first sync, patches afterwards, deletes idempotently", async () => {
    const dns = new HttpDnsProvider(url, "secret");
    const cfg = {
      clientId: "abcdefghijklmnopqrst",
      profile: "child" as const,
      blockedCategories: ["social", "adult"] as const,
      allowDomains: ["example.com"],
      blockDomains: [],
    };
    await dns.upsertClient({ ...cfg, blockedCategories: [...cfg.blockedCategories] });
    expect(seen).toEqual(["PATCH /v1/clients/abcdefghijklmnopqrst", "POST /v1/clients"]);
    expect(clients.get(cfg.clientId)).toEqual({
      client_id: cfg.clientId,
      profile: "child",
      blocked_categories: ["adult", "social"],
      block_adult: true,
      allow_domains: ["example.com"],
      block_domains: [],
    });
    await dns.upsertClient({ ...cfg, blockedCategories: ["social"] });
    expect(seen.at(-1)).toBe("PATCH /v1/clients/abcdefghijklmnopqrst");
    expect(clients.get(cfg.clientId)!.block_adult).toBe(false);
    expect(clients.get(cfg.clientId)!.blocked_categories).toEqual(["social"]);
    await dns.upsertClient({ ...cfg, blockedCategories: [] }); // every switch off is sent as an empty list
    expect(clients.get(cfg.clientId)!.blocked_categories).toEqual([]);
    await dns.deleteClient(cfg.clientId);
    await dns.deleteClient(cfg.clientId); // 404 is fine
    expect(clients.size).toBe(0);
  });

  it("fails loudly on a wrong token, so the sweeper retries", async () => {
    const dns = new HttpDnsProvider(url, "wrong");
    await expect(
      dns.upsertClient({ clientId: "x2345", profile: "self", blockedCategories: [], allowDomains: [], blockDomains: [] }),
    ).rejects.toThrow(/401/);
  });
});
