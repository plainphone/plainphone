// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
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
