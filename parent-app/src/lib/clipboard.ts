// SPDX-License-Identifier: Apache-2.0
//
// "Copy position". The app has no clipboard module (expo-clipboard would be a native
// dependency), so on a phone the text goes to the system share sheet, which has a Copy
// action on iOS and Android. The browser build writes to the clipboard directly.
import { Platform, Share } from "react-native";

export type CopyResult = "copied" | "shared";

/** "copied" when the text is on the clipboard; "shared" when the share sheet was opened instead. */
export async function copyText(text: string): Promise<CopyResult> {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return "copied";
  }
  await Share.share({ message: text });
  return "shared";
}
