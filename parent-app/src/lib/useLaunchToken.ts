// SPDX-License-Identifier: Apache-2.0
//
// Reads an invitation token from the link that opened (or reached) the app. Same two
// sources as app/auth/app.tsx: the URL the app was launched with and the latest URL it
// received, and window.location on the web.
import * as Linking from "expo-linking";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { inviteTokenFromUrl } from "./links";

export function useLaunchToken(): { token: string | null; ready: boolean } {
  const linking = Linking.useLinkingURL();
  const [initial, setInitial] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    Linking.getInitialURL()
      .then((u) => setInitial(u ?? null))
      .catch(() => setInitial(null));
  }, []);
  const current = Platform.OS === "web" && typeof window !== "undefined" ? window.location.href : linking;
  return { token: inviteTokenFromUrl(current) ?? inviteTokenFromUrl(initial), ready: initial !== undefined };
}
