// SPDX-License-Identifier: Apache-2.0
//
// Renders the legacy launcher PNGs (mipmap-mdpi … mipmap-xxxhdpi) from brand direction C's
// adaptive icon layers (docs/brand/directions/c/adaptive-*.svg). Every supported Android version
// (minSdk 29) uses the adaptive icon in mipmap-anydpi-v26; the PNGs are for launchers and tools
// that ask for a bitmap. Run: node android/scripts/make-icons.mjs (needs web/ installed, it
// borrows @resvg/resvg-js from there). The PNGs are committed.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "..", "web", "package.json"));
const { Resvg } = require("@resvg/resvg-js");
const brand = join(here, "..", "..", "docs", "brand", "directions", "c");
const res = join(here, "..", "app", "src", "main", "res");

/** The inner drawing of an SVG file, without the outer <svg> element. */
const inner = (name) => readFileSync(join(brand, name), "utf8").replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const layers = inner("adaptive-background.svg") + inner("adaptive-foreground.svg");

// A launcher shows the middle 72 of the 108 dp canvas; clip it to a rounded square or a circle.
const icon = (shape) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="18 18 72 72">
  <defs><clipPath id="c">${shape}</clipPath></defs><g clip-path="url(#c)">${layers}</g></svg>`;
const square = icon('<rect x="18" y="18" width="72" height="72" rx="16"/>');
const round = icon('<circle cx="54" cy="54" r="36"/>');

const png = (svg, size) => new Resvg(svg, { background: "rgba(0,0,0,0)", fitTo: { mode: "width", value: size } }).render().asPng();

for (const [density, size] of [["mdpi", 48], ["hdpi", 72], ["xhdpi", 96], ["xxhdpi", 144], ["xxxhdpi", 192]]) {
  const dir = join(res, `mipmap-${density}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, svg] of [["ic_launcher", square], ["ic_launcher_round", round]]) {
    const data = png(svg, size);
    writeFileSync(join(dir, `${name}.png`), data);
    console.log(`wrote mipmap-${density}/${name}.png (${data.length} bytes)`);
  }
}
