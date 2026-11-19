// SPDX-License-Identifier: Apache-2.0
// Dev-only browser checks on the built site (run `npm run build` first):
// every page in every language at 320, 390, 768 and 1280 px, light and dark.
//  - no horizontal scrolling (320 px is also what 400 % zoom gives on a 1280 px window)
//  - axe-core with the WCAG 2.0-2.2 A and AA rules, including contrast and target size
//  - the small-screen menu and the language menu open without JavaScript and lead somewhere
//  - the first Tab reaches the skip link, and focus is visible
//   NODE_PATH=<dir with playwright and axe-core> node tools/qa.mjs
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".mjs": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };

const server = createServer((req, res) => {
  let path = join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (path.endsWith("/")) path = join(path, "index.html");
  if (!existsSync(path) || statSync(path).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
  res.end(readFileSync(path));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const pages = walk(dist).filter((f) => f.endsWith("index.html")).map((f) => `/${f.slice(dist.length).replace(/index\.html$/, "")}`).sort();
const errors = [];
const browser = await chromium.launch();

for (const scheme of ["light", "dark"]) {
  for (const width of [320, 390, 768, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme, javaScriptEnabled: width !== 390 });
    const page = await ctx.newPage();
    for (const path of pages) {
      await page.goto(base + path, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (overflow > 0) errors.push(`${path} ${width}px ${scheme}: ${overflow}px horizontal overflow`);
      // axe once per page and scheme at a phone and a desktop width (390 runs without JavaScript, so inject it elsewhere).
      if (width === 320 || width === 1280) {
        await page.addScriptTag({ content: axeSource });
        const result = await page.evaluate(async () => {
          // Open every disclosure so the questions and menus are checked too.
          document.querySelectorAll("details").forEach((d) => { d.open = true; });
          return axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] });
        });
        for (const v of result.violations) {
          errors.push(`${path} ${width}px ${scheme}: axe ${v.id} (${v.impact}) ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
        }
      }
    }
    await ctx.close();
  }
}

// Menus without JavaScript, and keyboard focus.
for (const [width, lang] of [[390, "da"], [1280, "en"]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(`${base}/${lang === "en" ? "" : `${lang}/`}`);
  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => ({ cls: document.activeElement.className, outline: getComputedStyle(document.activeElement).outlineStyle }));
  if (first.cls !== "skip" || first.outline === "none") errors.push(`${width}px: first Tab should show the skip link`);
  const menu = width < 900 ? ".menu" : ".lang";
  await page.click(`${menu} > summary`);
  const target = page.locator(`${menu} .pop-panel a[hreflang="sv"]`);
  if (!(await target.isVisible())) { errors.push(`${width}px: ${menu} does not open`); continue; }
  await target.click();
  if (!page.url().endsWith("/sv/")) errors.push(`${width}px: language menu went to ${page.url()}`);
  if (width < 900) {
    await page.click(".menu > summary");
    await page.locator('.menu nav a[href="/sv/setup/"]').click();
    if (!page.url().endsWith("/sv/setup/")) errors.push(`${width}px: menu link went to ${page.url()}`);
  }
  await ctx.close();
}

await browser.close();
server.close();
if (errors.length) {
  console.error(errors.join("\n"));
  console.error(`${errors.length} problems`);
  process.exit(1);
}
console.log(`OK: ${pages.length} pages × 4 widths × 2 colour schemes, axe WCAG 2.2 AA, menus and keyboard`);
