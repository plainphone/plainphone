// SPDX-License-Identifier: Apache-2.0
//
// Throwaway mail addresses (BLOCK_DISPOSABLE_EMAIL, docs/operations.md). Only a new household is
// refused: people with an account and people invited into a household are never stopped. The list
// is vendored in server/catalog/disposable-email (CC0) and read once; nothing is looked up online.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const listDir = fileURLToPath(new URL("../../catalog/disposable-email", import.meta.url));

export const DISPOSABLE_EMAIL_CODE = "disposable_email";

function readList(file: string): Set<string> {
  const text = readFileSync(join(listDir, file), "utf8");
  return new Set(text.split("\n").map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#")));
}

let lists: { blocked: Set<string>; allowed: Set<string> } | undefined;

function load() {
  lists ??= { blocked: readList("domains.txt"), allowed: readList("allow.txt") };
  return lists;
}

/** True when the address's domain, or a domain it is under, is a known throwaway service. */
export function isDisposableEmail(email: string): boolean {
  const domain = email.slice(email.lastIndexOf("@") + 1).trim().toLowerCase().replace(/\.$/, "");
  if (!domain) return false;
  const { blocked, allowed } = load();
  const labels = domain.split(".");
  // mail.throwaway.example is as disposable as throwaway.example; stop before the bare TLD.
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join(".");
    if (allowed.has(candidate)) return false;
    if (blocked.has(candidate)) return true;
  }
  return false;
}
