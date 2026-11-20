// SPDX-License-Identifier: Apache-2.0
import type { DnsCategory } from "../db/schema.js";

/** The DNS rules for one phone, identified by its DNS-over-TLS ClientID. */
export interface DnsClientConfig {
  clientId: string;
  profile: "child" | "self";
  blockedCategories: DnsCategory[];
  allowDomains: string[];
  blockDomains: string[];
}

/**
 * Talks to the filtering DNS service (see dns/ and docs/server-dns-contract.md).
 * Both calls must be idempotent: the server retries until they succeed.
 */
export interface DnsProvider {
  upsertClient(config: DnsClientConfig): Promise<void>;
  deleteClient(clientId: string): Promise<void>;
  /** True when the DNS service answers. Used by /api/health. */
  healthy(): Promise<boolean>;
}

/** Keeps the last config per client in memory. Used in tests and until the DNS service runs. */
export class MockDnsProvider implements DnsProvider {
  readonly clients = new Map<string, DnsClientConfig>();
  failNext = 0;
  failNextDelete = 0;

  async upsertClient(config: DnsClientConfig) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("mock DNS failure");
    }
    this.clients.set(config.clientId, structuredClone(config));
  }

  async deleteClient(clientId: string) {
    if (this.failNextDelete > 0) {
      this.failNextDelete--;
      throw new Error("mock DNS delete failure");
    }
    this.clients.delete(clientId);
  }

  async healthy() {
    return true;
  }
}

/**
 * Client for the Plainphone DNS service in dns/ (`/v1/clients`, see dns/README.md).
 *
 * Sends the profile, the blocked categories and the per-client allow/block lists. It also
 * sends `block_adult` (the same as "adult" being in the categories) for a DNS service from
 * before categories existed, which ignores `blocked_categories`; see docs/server-dns-contract.md.
 */
export class HttpDnsProvider implements DnsProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    const base = this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`;
    return fetch(new URL(path, base), {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  }

  async upsertClient(config: DnsClientConfig) {
    const payload = {
      profile: config.profile,
      blocked_categories: [...config.blockedCategories].sort(),
      block_adult: config.blockedCategories.includes("adult"),
      allow_domains: config.allowDomains,
      block_domains: config.blockDomains,
    };
    const id = encodeURIComponent(config.clientId);
    let res = await this.call("PATCH", `v1/clients/${id}`, payload);
    if (res.status === 404) {
      res = await this.call("POST", "v1/clients", { client_id: config.clientId, ...payload });
    }
    if (!res.ok) throw new Error(`DNS service upsert failed: ${res.status}`);
  }

  async deleteClient(clientId: string) {
    const res = await this.call("DELETE", `v1/clients/${encodeURIComponent(clientId)}`);
    if (!res.ok && res.status !== 404) throw new Error(`DNS service delete failed: ${res.status}`);
  }

  async healthy() {
    try {
      const base = this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`;
      const res = await fetch(new URL("healthz", base), { signal: AbortSignal.timeout(3_000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}
