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
