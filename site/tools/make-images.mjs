// SPDX-License-Identifier: Apache-2.0
// Dev-only: renders OG images and PNG icons into src/ with Playwright.
// The output is committed, so the site build needs no dependencies.
//   NODE_PATH=<dir with playwright> node tools/make-images.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import en from "../content/en.mjs";
import da from "../content/da.mjs";
import sv from "../content/sv.mjs";
import nb from "../content/nb.mjs";
import de from "../content/de.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const font = readFileSync(join(src, "fonts/atkinson-hyperlegible-next.woff2")).toString("base64");
const wordmark = readFileSync(join(src, "wordmark.svg"), "utf8");
const favicon = readFileSync(join(src, "favicon.svg"), "utf8");

const base = `@font-face{font-family:A;src:url(data:font/woff2;base64,${font}) format("woff2");font-weight:200 800}
*{margin:0;box-sizing:border-box}body{font-family:A;background:#f3f5f2;color:#1d2a30}`;

function og(t) {
  return `<!doctype html><html><head><style>${base}
.c{width:1200px;height:630px;padding:72px 84px;display:flex;flex-direction:column;justify-content:space-between}
.w svg{height:44px;width:auto;display:block}
h1{font-size:104px;line-height:.98;letter-spacing:-.035em;font-weight:700;max-width:1032px}
ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:12px 34px;font-size:30px;font-weight:600}
.g{color:#4c5a60;font-weight:400;text-decoration:line-through;text-decoration-thickness:.1em;text-decoration-color:#1d2a30}
</style></head><body><div class="c"><div class="w">${wordmark}</div>
<h1>${t.hero.title}</h1>
<ul>${t.hero.stays.slice(0, 3).map((s) => `<li>${s}</li>`).join("")}${t.hero.goes
    .slice(0, 2)
    .map((s) => `<li class="g">${s}</li>`)
    .join("")}</ul></div></body></html>`;
}

const icon = (size, pad) =>
  `<!doctype html><html><head><style>html,body{margin:0;background:#f3f5f2}
div{width:${size}px;height:${size}px;padding:${pad}px}svg{width:100%;height:100%;display:block}</style></head>
<body><div>${favicon}</div></body></html>`;

const browser = await chromium.launch({ chromiumSandbox: true });
const page = await browser.newPage({ deviceScaleFactor: 1, colorScheme: "light" });
for (const t of [en, da, sv, nb, de]) {
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(og(t));
  await page.evaluate(() => document.fonts.ready);
  if (await page.evaluate(() => document.documentElement.scrollHeight > 630 || document.documentElement.scrollWidth > 1200)) {
    throw new Error(`OG image for ${t.lang} overflows`);
  }
  writeFileSync(join(src, `og-${t.lang}.png`), await page.screenshot({ type: "png" }));
}
for (const [name, size, pad] of [["favicon-32.png", 32, 0], ["apple-touch-icon.png", 180, 22]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(icon(size, pad));
  writeFileSync(join(src, name), await page.screenshot({ type: "png", omitBackground: name === "favicon-32.png" }));
}
await browser.close();
console.log("Wrote five OG images and two icons");
