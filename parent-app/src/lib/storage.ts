// SPDX-License-Identifier: Apache-2.0
//
// Small key-value store. On phones the session token goes to the Keychain/Keystore
// (expo-secure-store). The web build (used for screenshots and development) falls
// back to sessionStorage, so a token never outlives the browser tab there.
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const web = Platform.OS === "web";

export async function getItem(key: string): Promise<string | null> {
  if (web) {
    try {
      return globalThis.sessionStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (web) {
    try {
      globalThis.sessionStorage?.setItem(key, value);
    } catch {
      // private mode: lasts for this visit
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function removeItem(key: string): Promise<void> {
  if (web) {
    try {
      globalThis.sessionStorage?.removeItem(key);
    } catch {
      // ignore
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
