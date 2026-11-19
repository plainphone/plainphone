// SPDX-License-Identifier: Apache-2.0
// The common tokens (docs/research/ux-premium.md, "Shared design system proposal") must be the same
// on the site, the web dashboard, the Expo parent app and Android, and every text pair must stay AA.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");

const COMMON = {
  light: {
    paper: "#f2f3ef", sheet: "#ffffff", ink: "#1c2321", pencil: "#4d5753", divider: "#dfe3df", outline: "#7a8580",
    action: "#24604a", onAction: "#ffffff", tint: "#e3efe8", attention: "#fbf1d9", danger: "#a3261d", dangerFill: "#fbe9e7",
  },
  dark: {
    paper: "#121816", sheet: "#1b2320", ink: "#e8ece9", pencil: "#a9b3ae", divider: "#2c3833", outline: "#6b7873",
    action: "#7fc4a2", onAction: "#0d1a14", tint: "#22322b", attention: "#33301f", danger: "#f08a80", dangerFill: "#3a2321",
  },
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

const MAPS = {
  site: { paper: "paper", sheet: "sheet", ink: "ink", pencil: "pencil", divider: "rule", outline: "outline", action: "link", onAction: "on-link", attention: "mark" },
  web: {
    paper: "bg", sheet: "surface", ink: "ink", pencil: "muted", divider: "line", outline: "border-strong", action: "accent",
    onAction: "on-accent", tint: "tint", attention: "warn-bg", danger: "danger", dangerFill: "danger-bg",
  },
};

for (const [name, file] of [["site", "site/src/style.css"], ["web", "web/src/styles.css"]]) {
  test(`${name} uses the common tokens`, () => {
    const v = cssVars(read(file));
    for (const theme of ["light", "dark"]) {
      for (const [role, variable] of Object.entries(MAPS[name])) {
        assert.equal(v[theme][variable], COMMON[theme][role], `${name} ${theme} --${variable} (${role})`);
      }
    }
  });
}

test("the Expo parent app uses the common tokens", () => {
  const src = read("parent-app/src/lib/theme.ts");
  const obj = (n) => {
    const body = src.match(new RegExp(`${n}(?::\\s*Colors)?\\s*=\\s*\\{([^}]*)\\}`))[1];
    return Object.fromEntries([...body.matchAll(/(\w+):\s*"(#[0-9a-fA-F]{6})"/g)].map((m) => [m[1], m[2].toLowerCase()]));
  };
  const map = {
    paper: "bg", sheet: "surface", ink: "ink", pencil: "muted", divider: "line", outline: "borderStrong", action: "accent",
    onAction: "onAccent", tint: "tint", attention: "warnBg", danger: "danger", dangerFill: "dangerBg",
  };
  for (const [theme, n] of [["light", "export const light"], ["dark", "export const dark"]]) {
    const o = obj(n);
    for (const [role, key] of Object.entries(map)) assert.equal(o[key], COMMON[theme][role], `expo ${theme} ${key}`);
  }
});

test("Android uses the common tokens", () => {
  const src = read("android/app/src/main/java/org/plainphone/app/ui/Tokens.kt");
  for (const [theme, n] of [["light", "Light"], ["dark", "Dark"]]) {
    const body = src.match(new RegExp(`val ${n} = PlainTokens\\(([\\s\\S]*?)\\n        \\)`))[1];
    const o = Object.fromEntries([...body.matchAll(/(\w+) = Color\(0xFF([0-9A-Fa-f]{6})\)/g)].map((m) => [m[1], `#${m[2].toLowerCase()}`]));
    for (const [role, hex] of Object.entries(COMMON[theme])) assert.equal(o[role], hex, `android ${theme} ${role}`);
  }
});

test("common tokens meet WCAG AA", () => {
  for (const [theme, t] of Object.entries(COMMON)) {
    for (const surface of [t.paper, t.sheet]) {
      for (const fg of [t.ink, t.pencil, t.action, t.danger]) assert.ok(ratio(fg, surface) >= 4.5, `${theme} ${fg} on ${surface}`);
      assert.ok(ratio(t.outline, surface) >= 3, `${theme} outline on ${surface}`);
    }
    assert.ok(ratio(t.onAction, t.action) >= 4.5, `${theme} on-action`);
    assert.ok(ratio(t.ink, t.tint) >= 4.5 && ratio(t.action, t.tint) >= 4.5, `${theme} tint`);
    assert.ok(ratio(t.ink, t.attention) >= 4.5, `${theme} attention`);
    assert.ok(ratio(t.danger, t.dangerFill) >= 4.5, `${theme} danger fill`);
  }
});
