// SPDX-License-Identifier: Apache-2.0
//
// Renders the PWA icons and the mail logo from SVG. Run: pnpm --filter @plainphone/web icons
// The PNGs are committed, so a normal build does not need this script.
// The mail logo text uses DejaVu Sans Bold (fonts-dejavu on Debian/Ubuntu).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const ACCENT = "#24604a";
const INK = "#1c2321";

/** The mark on a 64 unit grid. `pad` shrinks it inside the canvas (maskable safe zone). */
function mark({ size, rounded = true, pad = 0 }) {
  const s = 64 - pad * 2;
  const k = s / 64;
  const g = `<g transform="translate(${pad} ${pad}) scale(${k})">
    <rect x="19" y="10" width="26" height="44" rx="7" fill="none" stroke="#fff" stroke-width="4"/>
    <path d="M24.5 33c2.5-2.6 5-2.6 7.5 0s5 2.6 7.5 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
  </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="${rounded ? 16 : 0}" fill="${ACCENT}"/>${g}</svg>`;
}

function png(svg, opts = {}) {
  return new Resvg(svg, { background: "rgba(0,0,0,0)", ...opts }).render().asPng();
}

function write(rel, data) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  console.log(`wrote ${rel} (${data.length} bytes)`);
}

for (const size of [192, 512]) {
  write(`icons/icon-${size}.png`, png(mark({ size })));
  // Maskable: full-bleed background, artwork inside the 80 % safe zone.
  write(`icons/maskable-${size}.png`, png(mark({ size, rounded: false, pad: 7 })));
}
write("icons/apple-touch-icon.png", png(mark({ size: 180, rounded: false, pad: 4 })));

// Mail logo: 264x64 (shown at 132x32), mark plus the word in ink on transparent.
const font = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
if (!existsSync(font)) throw new Error(`missing font ${font}`);
// Two variants: ink text for light mail clients, light text for dark mode.
const logo = (text) => `<svg xmlns="http://www.w3.org/2000/svg" width="264" height="64" viewBox="0 0 264 64">
  <g transform="translate(4 4) scale(0.875)">
    <rect width="64" height="64" rx="16" fill="${ACCENT}"/>
    <rect x="19" y="10" width="26" height="44" rx="7" fill="none" stroke="#fff" stroke-width="4"/>
    <path d="M24.5 33c2.5-2.6 5-2.6 7.5 0s5 2.6 7.5 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
  </g>
  <text x="72" y="43" font-family="DejaVu Sans" font-weight="700" font-size="29" letter-spacing="-0.6" fill="${text}">Plainphone</text>
</svg>`;
const fontOpts = { font: { fontFiles: [font], loadSystemFonts: false, defaultFontFamily: "DejaVu Sans" } };
write("mail/logo@2x.png", png(logo(INK), fontOpts));
write("mail/logo-dark@2x.png", png(logo("#e8ece9"), fontOpts));
