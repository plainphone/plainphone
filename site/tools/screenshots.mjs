// SPDX-License-Identifier: Apache-2.0
// Dev-only: full-page screenshots, mobile and desktop, light and dark.
//   NODE_PATH=<dir with playwright> node tools/screenshots.mjs <base-url> <out-dir>
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [base = "http://localhost:4321", out = "screenshots"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
for (const [vp, size, scale] of [["mobile", { width: 390, height: 844 }, 2], ["desktop", { width: 1440, height: 900 }, 1]]) {
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: scale, colorScheme: scheme });
    const page = await ctx.newPage();
    for (const [name, path] of [["en", "/"], ["da", "/da/"]]) {
      const res = await page.goto(base + path, { waitUntil: "networkidle" });
      if (!res.ok()) throw new Error(`${path}: ${res.status()}`);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(out, `${name}-${vp}-${scheme}.png`), fullPage: true });
    }
    await ctx.close();
  }
}
await browser.close();
console.log(`Screenshots in ${out}`);
