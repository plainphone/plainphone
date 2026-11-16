// SPDX-License-Identifier: Apache-2.0
//
// Which Plainphone server the app talks to. The hosted service by default; a
// self-hosted build sets `expo.extra.serverUrl` in app.json (or PLAINPHONE_SERVER_URL
// at build time via app.config.ts).
import Constants from "expo-constants";

const DEFAULT_SERVER = "https://app.plainphone.org";

function clean(url: string): string {
  return url.replace(/\/+$/, "");
}

export const SERVER_URL: string = clean(
  (Constants.expoConfig?.extra?.serverUrl as string | undefined) ?? DEFAULT_SERVER,
);

export const API_URL = `${SERVER_URL}/api`;

/** Host part, for matching incoming universal/app links. */
export const SERVER_HOST = SERVER_URL.replace(/^https?:\/\//, "").split("/")[0];
