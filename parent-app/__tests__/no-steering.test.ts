// SPDX-License-Identifier: Apache-2.0
//
// The parent app is a store app: it must never send anyone to a card payment (store
// anti-steering rules, docs/billing.md). This scans the app's own source and fails on any
// mention of Stripe or a checkout, and on any call that buys an early unlock. The generated API
// schema is left out; the code shared with the web dashboard lives in packages/, outside src.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(__dirname, "..", "src");
const skipped = (rel: string) => rel === join("api", "schema.d.ts");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const rel = relative(root, path);
    if (skipped(rel)) return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx|js|jsx)$/.test(name) ? [path] : [];
  });
}

const BANNED: [string, RegExp][] = [
  ["stripe", /stripe/i],
  ["checkout", /checkout/i],
  ["buying an early unlock", /changes\/(\{cid\}|\$\{[^}]+\}|[^/"'`\s]+)\/early-unlock/],
];

it("scans a real set of app files", () => {
  const files = sources(root).map((f) => relative(root, f));
  expect(files.length).toBeGreaterThan(20);
  expect(files).toContain(join("components", "Billing.tsx"));
  expect(files).not.toContain(join("api", "schema.d.ts"));
});

it("catches what it is meant to catch", () => {
  const caught = (s: string) => BANNED.some(([, re]) => re.test(s));
  expect(caught('client.POST("/changes/{cid}/early-unlock", {})')).toBe(true);
  expect(caught("fetch(`/api/changes/${change.id}/early-unlock`)")).toBe(true);
  expect(caught("window.open(checkoutUrl)")).toBe(true);
  expect(caught("Stripe")).toBe(true);
  expect(caught('client.POST("/early-unlocks/{id}/withdraw")')).toBe(false);
});

it.each(sources(root).map((f) => [relative(root, f), f]))("%s never points to a card payment", (_rel, file) => {
  const text = readFileSync(file, "utf8");
  for (const [what, re] of BANNED) expect({ what, match: re.exec(text)?.[0] ?? null }).toEqual({ what, match: null });
});
