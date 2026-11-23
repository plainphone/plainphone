// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createDb, DEFAULT_POOL_MAX } from "../src/db/client.js";

// The pool size is the first limit a busy server meets (docs/operations.md#capacity).
describe("DB_POOL_MAX", () => {
  it("keeps the pool of 10 when unset or empty, as Compose passes it", () => {
    expect(loadConfig({ DATABASE_URL: "x" }).DB_POOL_MAX).toBe(10);
    expect(loadConfig({ DATABASE_URL: "x", DB_POOL_MAX: "" }).DB_POOL_MAX).toBe(10);
    expect(DEFAULT_POOL_MAX).toBe(10);
  });

  it("takes a larger pool and refuses nonsense", () => {
    expect(loadConfig({ DATABASE_URL: "x", DB_POOL_MAX: "20" }).DB_POOL_MAX).toBe(20);
    for (const bad of ["0", "-1", "2.5", "101", "many"]) {
      expect(() => loadConfig({ DATABASE_URL: "x", DB_POOL_MAX: bad }), bad).toThrow();
    }
  });

  it("sizes the connection pool", async () => {
    const pools = [createDb("postgres://x@127.0.0.1:1/x"), createDb("postgres://x@127.0.0.1:1/x", 20)];
    try {
      expect(pools.map((p) => p.sql.options.max)).toEqual([10, 20]);
    } finally {
      await Promise.all(pools.map((p) => p.sql.end()));
    }
  });
});
