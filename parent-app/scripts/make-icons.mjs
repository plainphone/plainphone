// SPDX-License-Identifier: Apache-2.0
//
// Renders the app icons from brand direction C (docs/brand/directions/c/*.svg), the same
// drawings as the web dashboard and the phone.
// Run: pnpm icons (needs web/ installed, it borrows @resvg/resvg-js from there).
// The PNGs are committed, so a normal build does not need this script.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "..", "web", "package.json"));
const { Resvg } = require("@resvg/resvg-js");
const brand = join(here, "..", "..", "docs", "brand", "directions", "c");
const out = join(here, "..", "assets");
const svg = (name) => readFileSync(join(brand, name), "utf8");
const png = (source, width) =>
  new Resvg(source, { background: "rgba(0,0,0,0)", fitTo: { mode: "width", value: width } }).render().asPng();
function write(name, data) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, name), data);
  console.log(`wrote assets/${name} (${data.length} bytes)`);
}

// iOS: full-bleed graphite square, the system rounds the corners.
write("icon.png", png(svg("app-icon.svg"), 1024));
// Android adaptive icon (108 dp canvas): signal-green switch on graphite, and the themed-icon layer.
write("android-icon-foreground.png", png(svg("adaptive-foreground.svg"), 1024));
write("android-icon-background.png", png(svg("adaptive-background.svg"), 1024));
write("android-icon-monochrome.png", png(svg("adaptive-monochrome.svg"), 1024));
// Splash: the mark alone, with an ink edge on the light background and without it on dark.
write("splash-icon.png", png(svg("mark.svg"), 512));
write("splash-icon-dark.png", png(svg("mark-dark.svg"), 512));
// Android status bar: white on transparent, the system only reads the alpha (96 px = xxxhdpi).
write("notification-icon.png", png(svg("notification.svg"), 96));
write("favicon.png", png(svg("favicon.svg"), 48));
