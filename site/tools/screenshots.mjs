// SPDX-License-Identifier: Apache-2.0
// Dev-only: full-page screenshots of the English and Danish front pages at 390 and
// 1280 px, light and dark, named <prefix>-<lang>-<width>-<scheme>.png.
//   NODE_PATH=<dir with playwright> node tools/screenshots.mjs <base-url> <out-dir> [prefix]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [base = "http://localhost:4321", out = "screenshots", prefix = "site"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
for (const width of [390, 1280]) {
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme: scheme });
    const page = await ctx.newPage();
    for (const [lang, path] of [["en", "/"], ["da", "/da/"]]) {
      const res = await page.goto(base + path, { waitUntil: "networkidle" });
      if (!res.ok()) throw new Error(`${path}: ${res.status()}`);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(out, `${prefix}-${lang}-${width}-${scheme}.png`), fullPage: true });
    }
    await ctx.close();
  }
}
await browser.close();
console.log(`Screenshots in ${out}`);
