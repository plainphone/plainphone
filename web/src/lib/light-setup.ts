// SPDX-License-Identifier: Apache-2.0

export function lightSetupLink(serverUrl: string, token: string, pinHash: string, pinSalt: string, locale: string) {
  const url = new URL("/install-phone", serverUrl);
  url.hash = new URLSearchParams({ token, pinHash, pinSalt, lang: locale }).toString();
  return url.href;
}

export function lightSetupIntent(url: URL): string | null {
  const fields = new URLSearchParams(url.hash.slice(1));
  const token = fields.get("token") ?? "";
  const pinHash = fields.get("pinHash") ?? "";
  const pinSalt = fields.get("pinSalt") ?? "";
  if (!/^pp_e_[A-Za-z0-9_-]{22}$/.test(token) || !/^[0-9a-f]{64}$/.test(pinHash) || !/^[0-9a-f]{32}$/.test(pinSalt)) return null;
  const query = new URLSearchParams({ token, pinHash, pinSalt, server: url.origin });
  return `intent://setup?${query}#Intent;scheme=plainphone;package=org.plainphone.app;end`;
}
