// SPDX-License-Identifier: Apache-2.0
//
// A login link someone else sent would sign the app into their account (login CSRF), and a
// parent who then adds a phone would give that account the child's phone. The app remembers
// that it asked for a link, so the link that comes back is used without a question; any other
// link asks first (app/auth/app.tsx).
import { getItem, removeItem, setItem } from "./storage";

const KEY = "pp.linkAsked";
/** How long a login link works (the server's magic-link lifetime). */
const LINK_LIFETIME_MS = 15 * 60 * 1000;

export async function noteLinkAsked(): Promise<void> {
  await setItem(KEY, String(Date.now())).catch(() => undefined);
}

/** Whether this app asked for a login link that can still be valid. */
export async function linkAskedHere(): Promise<boolean> {
  const at = Number(await getItem(KEY).catch(() => null));
  const age = Date.now() - at;
  return at > 0 && age >= 0 && age < LINK_LIFETIME_MS;
}

export async function forgetLinkAsked(): Promise<void> {
  await removeItem(KEY).catch(() => undefined);
}
