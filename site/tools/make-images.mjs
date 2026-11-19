// SPDX-License-Identifier: Apache-2.0
// Dev-only: renders the OG share images and the PNG icons into src/ with Playwright,
// in brand direction C (docs/brand/README.md). The output is committed, so the site
// build needs no dependencies.
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
import { home } from "../content/home.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const font = (file) => readFileSync(join(src, "fonts", file)).toString("base64");
const brand = (file) => readFileSync(join(src, "brand", file), "utf8");
const wordmark = brand("wordmark.svg");
const mark = brand("mark.svg");

const base = `@font-face{font-family:S;src:url(data:font/woff2;base64,${font("schibsted-grotesk.woff2")}) format("woff2");font-weight:400 700}
@font-face{font-family:M;src:url(data:font/woff2;base64,${font("ibm-plex-mono-500.woff2")}) format("woff2");font-weight:500}
*{margin:0;box-sizing:border-box}body{font-family:S;background:#f5f5f3;color:#141414}`;

// Five switches from the hero panel: the first three on, the last two off.
function og(t) {
  const p = home[t.lang].panel;
  const rows = [...p.rows.slice(0, 3), ...p.rows.slice(-2)];
  return `<!doctype html><html><head><style>${base}
.c{width:1200px;height:630px;padding:64px 72px;display:grid;grid-template-columns:1fr 400px;gap:64px;align-items:center}
.l{height:100%;display:flex;flex-direction:column;justify-content:space-between}
.w{display:flex;align-items:center;gap:16px}.w svg:first-child{width:60px;height:60px}.w svg:last-child{height:36px;width:auto;color:#141414}
h1{font-size:88px;line-height:1;letter-spacing:-.04em;font-weight:700}
.n{font:500 22px M;color:#525252}
.p{background:#fff;border:2px solid #141414;border-radius:8px;padding:6px 28px 0}
.p div{display:flex;justify-content:space-between;align-items:center;height:76px;border-bottom:1.5px solid #e3e3e0;font-size:30px}
.p div:last-child{border:0}.p .off{color:#525252}
.s{width:68px;height:40px;border-radius:20px;border:2px solid #767676;position:relative;background:#fff}
.s::after{content:"";position:absolute;top:8px;left:7px;width:22px;height:22px;border-radius:50%;background:#767676}
.on .s{background:#c5f04a;border-color:#141414}.on .s::after{left:auto;right:7px;background:#141414}
</style></head><body><div class="c"><div class="l"><div class="w">${mark}${wordmark}</div>
<h1>${t.hero.title}</h1>
<p class="n">${home[t.lang].note}</p></div>
<div class="p">${rows.map(([label, on]) => `<div class="${on ? "on" : "off"}"><span>${label}</span><span class="s"></span></div>`).join("")}</div>
</div></body></html>`;
}

const icon = (svg, size) =>
  `<!doctype html><html><head><style>html,body{margin:0;background:transparent}
svg{width:${size}px;height:${size}px;display:block}</style></head><body>${svg}</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1, colorScheme: "light" });
for (const t of [en, da, sv, nb, de]) {
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(og(t));
  await page.evaluate(() => document.fonts.ready);
  if (await page.evaluate(() => document.documentElement.scrollHeight > 630 || document.documentElement.scrollWidth > 1200
      || [...document.querySelectorAll("h1, .n")].some((e) => e.scrollWidth > e.clientWidth))) {
    throw new Error(`OG image for ${t.lang} overflows`);
  }
  writeFileSync(join(src, `og-${t.lang}.png`), await page.screenshot({ type: "png" }));
}
// favicon-32 from the 32 px drawing (rounded tile, transparent corners); the
// apple-touch icon is full bleed, iOS rounds it.
for (const [name, file, size] of [["favicon-32.png", "favicon.svg", 32], ["apple-touch-icon.png", "app-icon.svg", 180]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(icon(brand(file), size));
  writeFileSync(join(src, name), await page.screenshot({ type: "png", omitBackground: true }));
}
await browser.close();
console.log("Wrote five OG images and two icons");
