// SPDX-License-Identifier: Apache-2.0
//
// Refreshes server/catalog/disposable-email/domains.txt from the maintained upstream list
// (CC0 1.0). Run by hand: `node server/scripts/update-disposable-domains.mjs`, then read the diff.
// The server never fetches the list itself.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SOURCE =
  "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf";
const target = fileURLToPath(new URL("../catalog/disposable-email/domains.txt", import.meta.url));
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

const parse = (text) =>
  new Set(text.split("\n").map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#")));

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`upstream answered ${res.status}`);
const next = parse(await res.text());
const bad = [...next].filter((d) => !DOMAIN.test(d));
if (bad.length > 0) throw new Error(`upstream has ${bad.length} lines that are not domains; not updating`);
// A list that shrank a lot is more likely a broken upstream than a cleanup.
const old = parse(await readFile(target, "utf8").catch(() => ""));
if (old.size > 0 && next.size < old.size * 0.8) throw new Error(`upstream shrank from ${old.size} to ${next.size}; not updating`);

await writeFile(target, `${[...next].sort().join("\n")}\n`);
const added = [...next].filter((d) => !old.has(d)).length;
const removed = [...old].filter((d) => !next.has(d)).length;
console.log(`${next.size} domains (${added} added, ${removed} removed)`);
