// SPDX-License-Identifier: Apache-2.0
//
// Renders the app icons from the Plainphone mark (same drawing as web/public/icon.svg).
// Run: pnpm icons (needs web/ installed, it borrows @resvg/resvg-js from there).
// The PNGs are committed, so a normal build does not need this script.

import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "..", "web", "package.json"));
const { Resvg } = require("@resvg/resvg-js");
const out = join(here, "..", "assets");
const ACCENT = "#24604a";

function lines(color, pad) {
  const k = (64 - pad * 2) / 64;
  return `<g transform="translate(${pad} ${pad}) scale(${k})">
    <rect x="19" y="10" width="26" height="44" rx="7" fill="none" stroke="${color}" stroke-width="4"/>
    <path d="M24.5 33c2.5-2.6 5-2.6 7.5 0s5 2.6 7.5 0" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/>
  </g>`;
}
const svg = (size, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${body}</svg>`;
const png = (s) => new Resvg(s, { background: "rgba(0,0,0,0)" }).render().asPng();
function write(name, data) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, name), data);
  console.log(`wrote assets/${name} (${data.length} bytes)`);
}

// iOS: full-bleed square, the system rounds the corners.
write("icon.png", png(svg(1024, `<rect width="64" height="64" fill="${ACCENT}"/>${lines("#fff", 6)}`)));
// Android adaptive icon: artwork inside the inner 66 % safe zone.
write("android-icon-foreground.png", png(svg(1024, lines("#fff", 14))));
write("android-icon-background.png", png(svg(1024, `<rect width="64" height="64" fill="${ACCENT}"/>`)));
write("android-icon-monochrome.png", png(svg(1024, lines("#000", 14))));
// Splash: the rounded mark, shown centred on the background colour.
write(
  "splash-icon.png",
  png(svg(512, `<rect width="64" height="64" rx="16" fill="${ACCENT}"/>${lines("#fff", 0)}`)),
);
write("favicon.png", png(svg(48, `<rect width="64" height="64" rx="16" fill="${ACCENT}"/>${lines("#fff", 0)}`)));
