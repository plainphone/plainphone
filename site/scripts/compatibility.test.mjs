// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { compatibilityContent } from "../compatibility.mjs";
import en from "../content/en.mjs";
import da from "../content/da.mjs";
import { matches } from "../src/app-search.mjs";

test("finds an app by name or by package in a Play Store link", () => {
  const terms = "MitID\ndk.mitid.app.android";
  assert.ok(matches(terms, " MITid "));
  assert.ok(matches(terms, "https://play.google.com/store/apps/details?id=dk.mitid.app.android&hl=da"));
  assert.ok(!matches(terms, "dk.mitid.other"));
});

test("accepts website links without treating their paths as domains", () => {
  assert.ok(matches("TikTok\ntiktok.com", "https://www.tiktok.com/@plainphone"));
  assert.ok(matches("YouTube\nwww.youtube.com", "youtube.com."));
  assert.ok(!matches("YouTube\nwww.youtube.com", "youtube.com.example.org"));
  assert.ok(!matches("TikTok\ntiktok.com", "https://example.org/tiktok.com"));
});

test("finds dotted app names that have a qualifier in the catalog", () => {
  assert.ok(matches("Sundhed.dk (MinSundhed)\ndk.example", "sundhed.dk"));
});

test("describes the initial filter for both profiles in both languages", () => {
  for (const [copy, blocked, strict, moderate] of [
    [en, /blocked by default on both profiles/i, /strict Restricted Mode/i, /moderate Restricted Mode/i],
    [da, /blokeret som standard på begge telefontyper/i, /streng begrænset tilstand/i, /moderat begrænset tilstand/i],
  ]) {
    const page = compatibilityContent(copy, (value) => value);
    const detail = (host) => page.split("</li>").find((row) => row.includes(`<span class="note">${host}</span>`));
    for (const host of ["tiktok.com", "onlyfans.com", "bet365.com", "www.roblox.com", "tinder.com", "twitch.tv"]) {
      assert.match(detail(host), blocked);
    }
    assert.match(detail("www.youtube.com"), strict);
    assert.match(detail("www.youtube.com"), moderate);
  }
});
