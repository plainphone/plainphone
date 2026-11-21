// SPDX-License-Identifier: Apache-2.0
//
// An invitation link arrives with its token in the URL fragment, which the router drops,
// and a parent who is not logged in has to log in first (a mail round trip, during which
// the app may be closed). The token is kept in memory and in the Keychain/Keystore until
// the invitation has been accepted or has failed, then removed. The PWA does the same
// with sessionStorage.
import { getItem, removeItem, setItem } from "./storage";

const KEY = "pp.invite";
let memory: string | null = null;

/**
 * The accept request per token, so one token is accepted once while the app runs. It belongs to
 * the signed-in account: logging out or switching server forgets it, or the next person to open
 * the same link would be shown the previous account's result without any request.
 */
export const acceptedInvites = new Map<string, Promise<unknown>>();

export function forgetAcceptedInvites(): void {
  acceptedInvites.clear();
}

export async function savePendingInvite(token: string): Promise<void> {
  memory = token;
  await setItem(KEY, token).catch(() => undefined);
}

export async function loadPendingInvite(): Promise<string | null> {
  if (memory) return memory;
  memory = await getItem(KEY).catch(() => null);
  return memory;
}

export async function clearPendingInvite(): Promise<void> {
  memory = null;
  await removeItem(KEY).catch(() => undefined);
}
