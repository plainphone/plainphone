// SPDX-License-Identifier: Apache-2.0
// The web dashboard, the Expo parent app and Android use brand direction C ("Switch",
// docs/brand/README.md): the same value per role and theme, read from the guide's palette:c table,
// and every text pair stays AA. The site keeps its own table until its redesign on direction C
// lands (feat/site-redesign-switch); then it is checked against the same table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");

/** The direction C palette from the brand guide's `<!-- palette:c -->` table. */
function switchPalette() {
  const table = read("docs/brand/README.md").match(/<!-- palette:c -->([\s\S]*?)<!-- \/palette:c -->/)[1];
  const rows = [...table.matchAll(/^\| (\w+) \| `(#[0-9a-f]{6})` \| `(#[0-9a-f]{6})` \|$/gm)];
  return {
    light: Object.fromEntries(rows.map((m) => [m[1], m[2]])),
    dark: Object.fromEntries(rows.map((m) => [m[1], m[3]])),
  };
}
const SWITCH = switchPalette();

/** The site's palette before its direction C redesign. */
const SITE = {
  light: { paper: "#f2f3ef", sheet: "#ffffff", ink: "#1c2321", pencil: "#4d5753", divider: "#dfe3df", outline: "#7a8580", action: "#24604a", onAction: "#ffffff", attention: "#fbf1d9" },
  dark: { paper: "#121816", sheet: "#1b2320", ink: "#e8ece9", pencil: "#a9b3ae", divider: "#2c3833", outline: "#6b7873", action: "#7fc4a2", onAction: "#0d1a14", attention: "#33301f" },
};

function lum(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** `--name: #hex` pairs of the first `:root` block and of the dark `:root` block, in that order. */
function cssVars(css) {
  const blocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]);
  const vars = (b) => Object.fromEntries([...b.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toLowerCase()]));
  return { light: vars(blocks[0]), dark: { ...vars(blocks[0]), ...vars(blocks[1]) } };
}

test("the brand guide's palette:c table has every role", () => {
  for (const theme of ["light", "dark"]) assert.equal(Object.keys(SWITCH[theme]).length, 14, `palette:c ${theme} in docs/brand/README.md`);
});

test("site uses its tokens", () => {
  const map = { paper: "paper", sheet: "sheet", ink: "ink", pencil: "pencil", divider: "rule", outline: "outline", action: "link", onAction: "on-link", attention: "mark" };
  const v = cssVars(read("site/src/style.css"));
  for (const theme of ["light", "dark"]) {
    for (const [role, variable] of Object.entries(map)) assert.equal(v[theme][variable], SITE[theme][role], `site ${theme} --${variable} (${role})`);
  }
});

test("web uses the direction C tokens", () => {
  const map = {
    paper: "bg", sheet: "surface", ink: "ink", pencil: "muted", divider: "line", outline: "border-strong", action: "accent",
    onAction: "on-accent", tint: "tint", attention: "warn-bg", danger: "danger", dangerFill: "danger-bg", brand: "brand", onBrand: "on-brand",
  };
  const v = cssVars(read("web/src/styles.css"));
  for (const theme of ["light", "dark"]) {
    for (const [role, variable] of Object.entries(map)) assert.equal(v[theme][variable], SWITCH[theme][role], `web ${theme} --${variable} (${role})`);
  }
});

test("the Expo parent app uses the direction C tokens", () => {
  const src = read("parent-app/src/lib/theme.ts");
  const obj = (n) => {
    const body = src.match(new RegExp(`${n}(?::\\s*Colors)?\\s*=\\s*\\{([^}]*)\\}`))[1];
    return Object.fromEntries([...body.matchAll(/(\w+):\s*"(#[0-9a-fA-F]{6})"/g)].map((m) => [m[1], m[2].toLowerCase()]));
  };
  const map = {
    paper: "bg", sheet: "surface", ink: "ink", pencil: "muted", divider: "line", outline: "borderStrong", action: "accent",
    onAction: "onAccent", tint: "tint", attention: "warnBg", danger: "danger", dangerFill: "dangerBg", brand: "brand", onBrand: "onBrand",
  };
  for (const [theme, n] of [["light", "export const light"], ["dark", "export const dark"]]) {
    const o = obj(n);
    for (const [role, key] of Object.entries(map)) assert.equal(o[key], SWITCH[theme][role], `expo ${theme} ${key}`);
  }
});

test("Android uses the direction C tokens", () => {
  const src = read("android/app/src/main/java/org/plainphone/app/ui/Tokens.kt");
  for (const [theme, n] of [["light", "Light"], ["dark", "Dark"]]) {
    const body = src.match(new RegExp(`val ${n} = PlainTokens\\(([\\s\\S]*?)\\n        \\)`))[1];
    const o = Object.fromEntries([...body.matchAll(/(\w+) = Color\(0xFF([0-9A-Fa-f]{6})\)/g)].map((m) => [m[1], `#${m[2].toLowerCase()}`]));
    for (const [role, hex] of Object.entries(SWITCH[theme])) assert.equal(o[role], hex, `android ${theme} ${role}`);
  }
});

test("direction C tokens meet WCAG AA", () => {
  for (const [theme, t] of Object.entries(SWITCH)) {
    for (const surface of [t.paper, t.sheet]) {
      for (const fg of [t.ink, t.pencil, t.action, t.danger]) assert.ok(ratio(fg, surface) >= 4.5, `${theme} ${fg} on ${surface}`);
      assert.ok(ratio(t.outline, surface) >= 3, `${theme} outline on ${surface}`);
    }
    assert.ok(ratio(t.onAction, t.action) >= 4.5, `${theme} on-action`);
    assert.ok(ratio(t.ink, t.tint) >= 4.5 && ratio(t.action, t.tint) >= 4.5, `${theme} tint`);
    assert.ok(ratio(t.ink, t.attention) >= 4.5, `${theme} attention`);
    assert.ok(ratio(t.danger, t.dangerFill) >= 4.5, `${theme} danger fill`);
    assert.ok(ratio(t.onBrand, t.brand) >= 4.5, `${theme} ink on signal green`);
  }
});
