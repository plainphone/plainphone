// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness.js";

const h = useHarness();

/** "METHOD /path/{param}" for every operation in openapi.yaml. */
function documented(): Set<string> {
  const text = readFileSync(new URL("../openapi.yaml", import.meta.url), "utf8");
  const body = text.slice(text.indexOf("\npaths:"));
  const ops = new Set<string>();
  let path = "";
  for (const line of body.split("\n")) {
    const p = /^ {2}(\/\S*):\s*$/.exec(line);
    if (p) path = p[1]!;
    const m = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (m && path) ops.add(`${m[1]!.toUpperCase()} ${path}`);
  }
  return ops;
}

describe("openapi.yaml", () => {
  it("documents exactly the routes the server has", () => {
    const routes = new Set(
      h.app.routes
        .filter((r) => r.path.startsWith("/api/") && r.path !== "/api/*" && r.method !== "ALL")
        .map((r) => {
          const path = r.path
            .replace(/^\/api/, "")
            .replace(/:(\w+)/g, "{$1}")
            .replace(/\/dns\/(allow|block)/, "/dns/{list}");
          return `${r.method} ${path}`;
        }),
    );
    // Middleware registered with app.use shows up as method ALL and is filtered out above.
    expect([...routes].sort()).toEqual([...documented()].sort());
  });
});
