// SPDX-License-Identifier: Apache-2.0
//
// Renders the PWA icons, the favicons and the mail logo from brand direction C
// (docs/brand/directions/c/*.svg). Run: pnpm --filter @plainphone/web icons
// The PNGs are committed, so a normal build does not need this script.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "public");
const brand = join(here, "..", "..", "docs", "brand", "directions", "c");
const svg = (name) => readFileSync(join(brand, name), "utf8");

/** Renders an SVG so that its width is `width` px. */
function png(source, width) {
  return new Resvg(source, { background: "rgba(0,0,0,0)", fitTo: { mode: "width", value: width } }).render().asPng();
}

function write(rel, data) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  console.log(`wrote ${rel} (${data.length} bytes)`);
}

// The SVG favicon is the 32 px and up drawing; the 16 px PNG uses the simplified drawing.
copyFileSync(join(brand, "favicon.svg"), join(root, "icon.svg"));
console.log("wrote icon.svg");
write("icons/favicon-16.png", png(svg("favicon-16.svg"), 16));
write("icons/favicon-32.png", png(svg("favicon.svg"), 32));

for (const size of [192, 512]) {
  // "any": full-bleed graphite square, the system or browser rounds it.
  write(`icons/icon-${size}.png`, png(svg("app-icon.svg"), size));
  // Maskable: artwork inside the 80 % safe zone.
  write(`icons/maskable-${size}.png`, png(svg("maskable.svg"), size));
}
write("icons/apple-touch-icon.png", png(svg("app-icon.svg"), 180));
// Web push badge: Android only reads the alpha, so it is the white status-bar icon.
write("icons/badge-96.png", png(svg("notification.svg"), 96));

// Mail logo: the outlined lockup, shown at 130 x 32 in the mail, so 2x is 519 x 128.
// One for light mail clients (switch with an ink edge, ink word) and one for dark (light word).
write("mail/lockup@2x.png", png(svg("lockup.svg"), 519));
write("mail/lockup-dark@2x.png", png(svg("lockup-dark.svg"), 519));
