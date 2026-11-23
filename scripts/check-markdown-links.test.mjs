// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { anchors, check, links, slug } from "./check-markdown-links.mjs";

test("slug follows GitHub's heading anchors", () => {
  assert.equal(slug("Known limitations"), "known-limitations");
  assert.equal(slug("5. Getting out again"), "5-getting-out-again");
  assert.equal(slug("Light mode: what it can't block"), "light-mode-what-it-cant-block");
  assert.equal(slug("Strong mode (Device Owner)"), "strong-mode-device-owner");
  assert.equal(slug("`/api/health` and 5xx"), "apihealth-and-5xx");
  assert.equal(slug("See [the docs](docs/x.md) now"), "see-the-docs-now");
  assert.equal(slug("snake_case and--dashes"), "snake_case-and--dashes");
  assert.equal(slug("Kører på dansk"), "kører-på-dansk");
  assert.equal(slug("Two  spaces"), "two--spaces");
  assert.equal(slug("**Bold** heading"), "bold-heading");
});

test("anchors number duplicate headings and skip code blocks", () => {
  const source = [
    "# Setup",
    "## Setup",
    "```sh",
    "# not a heading",
    "```",
    "Setext heading",
    "--------------",
    '<a id="custom-id"></a>',
    "## Setup ##",
  ].join("\n");
  assert.deepEqual([...anchors(source)].sort(), ["custom-id", "setext-heading", "setup", "setup-1", "setup-2"]);
});

test("anchors keep inline code text in headings", () => {
  const source = [
    "## Parent app (`org.plainphone.parent`)",
    "## `/api/health` and 5xx",
    "Setext with `code`",
    "===",
  ].join("\n");
  assert.deepEqual([...anchors(source)].sort(), ["apihealth-and-5xx", "parent-app-orgplainphoneparent", "setext-with-code"]);
});

test("HTML comments hold no links or headings", () => {
  const source = [
    "Before <!-- [hidden](gone.md) --> [shown](a.md)",
    "<!--",
    "## Commented out",
    "[hidden](gone.md)",
    "-->",
    "## Visible",
  ].join("\n");
  assert.deepEqual(links(source).map((link) => link.target), ["a.md"]);
  assert.deepEqual([...anchors(source)], ["visible"]);
});

test("links finds inline, reference, image and HTML links outside code", () => {
  const source = [
    "See [a](a.md#x) and ![b](img/b.png \"title\") and [c](<with space.md>).",
    "[ref]: docs/ref.md",
    "[^1]: A footnote, not a link.",
    '<img src="site/x.webp" width="2">',
    "`[code](not-a-link.md)`",
    "Wrapped [link](path/(1).md) here.",
  ].join("\n");
  assert.deepEqual(links(source).map((link) => link.target), [
    "a.md#x", "img/b.png", "with space.md", "docs/ref.md", "site/x.webp", "path/(1).md",
  ]);
});

test("check reports missing files and anchors, and ignores external links", () => {
  const root = mkdtempSync(join(tmpdir(), "md-links-"));
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs", "other.md"), "# Other page\n\n## Part two\n");
  writeFileSync(join(root, "code.ts"), "export {};\n");
  const file = join(root, "README.md");
  writeFileSync(file, [
    "# Top",
    "[ok](docs/other.md#part-two) [ok](#top) [ok](/docs/other.md) [ok](code.ts#L1) [ok](docs/)",
    "[ok](https://example.org/missing.md) [ok](mailto:someone@example.org)",
    "[bad](docs/gone.md) [bad](docs/other.md#part-three) [bad](#bottom)",
  ].join("\n"));
  assert.deepEqual(check(file, { root }), [
    "README.md:4: docs/gone.md -> docs/gone.md does not exist",
    'README.md:4: docs/other.md#part-three -> no heading or id "part-three" in docs/other.md',
    'README.md:4: #bottom -> no heading or id "bottom" in README.md',
  ]);
});
