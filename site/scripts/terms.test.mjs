// SPDX-License-Identifier: Apache-2.0
// The terms of the test service (content/terms.mjs, issue #244) and the data policy in the privacy
// policy (issue #239) must say the same things in all five languages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { terms } from "../content/terms.mjs";
import en from "../content/en.mjs";
import da from "../content/da.mjs";
import de from "../content/de.mjs";
import nb from "../content/nb.mjs";
import sv from "../content/sv.mjs";

const LANGS = { en, da, sv, nb, de };
const ANNOUNCEMENTS = "https://github.com/plainphone/plainphone/discussions/categories/announcements";

test("the terms exist in every language with the same sections", () => {
  assert.deepEqual(Object.keys(terms).sort(), Object.keys(LANGS).sort());
  const count = terms.en.sections.length;
  for (const [lang, t] of Object.entries(terms)) {
    assert.equal(t.sections.length, count, `${lang} has ${t.sections.length} sections, en has ${count}`);
    assert.equal(t.path, lang === "en" ? "/terms/" : `/${lang}/terms/`);
  }
});

for (const [lang, t] of Object.entries(terms)) {
  test(`${lang}: the terms name the provider, the contacts, the licence and the 30-day notice`, () => {
    const text = t.sections.flatMap((s) => s.body).join("\n");
    for (const needle of ["Mahoje", "CVR 39413892", "support@plainphone.org", "privacy@plainphone.org", "Apache License 2.0", ANNOUNCEMENTS, "30"]) {
      assert.ok(text.includes(needle), `does not mention ${needle}`);
    }
    assert.ok(text.includes(LANGS[lang].privacy.path), "does not link the privacy policy in the same language");
  });
}

for (const [lang, t] of Object.entries(LANGS)) {
  test(`${lang}: the privacy policy states the data policy of the test service`, () => {
    const text = t.privacy.sections.map((s) => s.body.join("\n")).join("\n");
    assert.ok(text.includes(ANNOUNCEMENTS), "does not link Discussions → Announcements");
    assert.ok(text.includes(terms[lang].path), "does not link the terms in the same language");
    assert.ok(text.includes("112"), "does not say that 112 keeps working after a wipe");
    assert.ok(text.includes("#recovery"), "does not link the help page on resetting a phone");
    assert.ok(t.privacy.short.list.some((li) => li.includes("30")), "the short version does not mention the 30-day notice");
  });
}
