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
}

/** Keeps the last config per client in memory. Used in tests and until the DNS service runs. */
export class MockDnsProvider implements DnsProvider {
  readonly clients = new Map<string, DnsClientConfig>();
  failNext = 0;

  async upsertClient(config: DnsClientConfig) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("mock DNS failure");
    }
    this.clients.set(config.clientId, structuredClone(config));
  }

  async deleteClient(clientId: string) {
    this.clients.delete(clientId);
  }
}

export class HttpDnsProvider implements DnsProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async call(method: string, path: string, body?: unknown) {
    const res = await fetch(new URL(path, this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`), {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok && !(method === "DELETE" && res.status === 404)) {
      throw new Error(`DNS service ${method} ${path} failed: ${res.status}`);
    }
  }

  upsertClient(config: DnsClientConfig) {
    const { clientId, ...rest } = config;
    return this.call("PUT", `clients/${encodeURIComponent(clientId)}`, rest);
  }

  deleteClient(clientId: string) {
    return this.call("DELETE", `clients/${encodeURIComponent(clientId)}`);
  }
}
