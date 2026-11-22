// SPDX-License-Identifier: Apache-2.0
// The privacy policy must describe what the Plainphone Parent app sends to OpenStreetMap's tile
// servers (parent-app/src/components/MapTiles.tsx, parent-app/src/lib/tiles.ts) in every language
// the site is published in, using the app's own button labels for the map switch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import en from "../content/en.mjs";
import da from "../content/da.mjs";
import de from "../content/de.mjs";
import nb from "../content/nb.mjs";
import sv from "../content/sv.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const LANGS = { en, da, de, nb, sv };

/** The parent app's label for a key in one language, read from its i18n file. */
function appLabel(lang, key) {
  const src = readFileSync(`${root}parent-app/src/i18n/app-${lang}.ts`, "utf8");
  const m = src.match(new RegExp(`"${key.replace(".", "\\.")}":\\s*"([^"]+)"`));
  assert.ok(m, `${key} missing in parent-app/src/i18n/app-${lang}.ts`);
  return m[1];
}

/** The location section's paragraphs of a language's privacy policy. */
function locationText(lang, t) {
  const id = lang === "da" ? "placering" : "location";
  const section = t.privacy.sections.find((s) => s.id === id);
  assert.ok(section, `privacy policy has no "${id}" section`);
  return section.body.join("\n");
}

// The code fetches tiles from this host only; the policy must name it and the operator's policy.
const tileUrl = readFileSync(`${root}parent-app/src/lib/tiles.ts`, "utf8").match(/return `https:\/\/([a-z.]+)\//);
assert.ok(tileUrl, "no tile URL found in parent-app/src/lib/tiles.ts");
const tileHost = tileUrl[1];

for (const [lang, t] of Object.entries(LANGS)) {
  test(`${lang}: the privacy policy explains the parent app's OpenStreetMap tile requests`, () => {
    const text = locationText(lang, t);
    assert.ok(text.includes(tileHost), `does not name ${tileHost}`);
    assert.ok(text.includes("osmfoundation.org/wiki/Privacy_Policy"), "does not link the OSMF privacy policy");
    assert.ok(text.includes("Plainphone Parent"), "does not name the Plainphone Parent app");
    // The map is opt-in and the choice is remembered: name both buttons as the app shows them.
    for (const key of ["native.showMap", "native.hideMap"]) {
      const label = appLabel(lang, key);
      assert.ok(text.includes(label), `does not use the app's own label "${label}" for ${key}`);
    }
    // How much a tile reveals: about 170 m at the closest zoom (17) to about 5 km at the widest (12).
    assert.match(text, /\b170 m\b/, "does not give the smallest area a tile reveals");
    assert.match(text, /\b5 km\b/, "does not give the largest area a tile reveals");
  });
}
