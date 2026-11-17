// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { useHarness } from "./harness.js";

const h = useHarness();

test("serves precompressed hashed assets and revalidates the PWA entry points", async () => {
  const dist = await mkdtemp(join(tmpdir(), "plainphone-pwa-"));
  try {
    const asset = "console.log('example');";
    const path = join(dist, "assets", "main-3g7DRWx0.js");
    await mkdir(join(dist, "assets"));
    await Promise.all([
      writeFile(path, asset),
      writeFile(path + ".br", brotliCompressSync(asset)),
      writeFile(path + ".gz", gzipSync(asset)),
      writeFile(join(dist, "index.html"), "<title>Example</title>"),
      writeFile(join(dist, "sw.js"), "/* worker */"),
    ]);
    const app = createApp({ ...h.ctx, cfg: { ...h.ctx.cfg, WEB_DIST: dist } });

    for (const [accept, encoding] of [
      ["br", "br"],
      ["gzip", "gzip"],
      ["identity", null],
      ["br;q=1.0, gzip;q=0.8", "br"],
      ["br;q=0.3, GZip;q=0.8", "gzip"],
      ["br;q=0, *;q=0.8", "gzip"],
      ["br;q=0, gzip;q=0", null],
    ] as const) {
      const res = await app.request("/assets/main-3g7DRWx0.js", { headers: { "accept-encoding": accept } });
      expect(res.headers.get("vary")).toBe("Accept-Encoding");
      expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(res.headers.get("content-encoding")).toBe(encoding);
      await res.arrayBuffer();
    }
    const ranged = await app.request("/assets/main-3g7DRWx0.js", {
      headers: { "accept-encoding": "br", range: "bytes=0-6" },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-encoding")).toBeNull();
    expect(await ranged.text()).toBe("console");

    for (const path of ["/", "/index.html", "/pair", "/sw.js", "/assets/missing-3g7DRWx0.js"]) {
      const res = await app.request(path);
      expect(res.headers.get("cache-control")).toBe("no-cache");
      await res.arrayBuffer();
    }
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});
