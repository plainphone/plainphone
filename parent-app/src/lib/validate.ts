// SPDX-License-Identifier: Apache-2.0
//
// Input checks that match the server's rules (the server has the final word). Same
// functions as in web/src/pages/Contacts.tsx and Filter.tsx.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Same rule as the server: + and 7 to 15 digits, spaces, dashes and brackets ignored. */
export function cleanNumber(raw: string): string {
  return raw.trim().replace(/[\s()-]/g, "");
}
export const NUMBER_RE = /^\+[1-9]\d{6,14}$/;

/** Roughly the server's rule for a website: no scheme, path, wildcard or trailing dot. */
export function cleanDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/^\*\./, "")
    .replace(/\.$/, "");
}
export const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;
