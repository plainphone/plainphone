// SPDX-License-Identifier: Apache-2.0

export function lightSetupLink(serverUrl: string, token: string, adminComponent: string, locale: string) {
  const url = new URL("/install-phone", serverUrl);
  url.hash = new URLSearchParams({ token, package: adminComponent.split("/")[0]!, lang: locale }).toString();
  return url.href;
}

export function lightSetupIntent(url: URL): string | null {
  const fields = new URLSearchParams(url.hash.slice(1));
  const token = fields.get("token") ?? "";
  const packageName = fields.get("package") ?? "";
  if (!/^pp_e_[A-Za-z0-9_-]{22}$/.test(token) || !/^[a-zA-Z]\w*(?:\.[a-zA-Z]\w*)+$/.test(packageName)) return null;
  const query = new URLSearchParams({ token, server: url.origin });
  const fallback = encodeURIComponent(new URL("/download/android", url.origin).href);
  return `intent://setup?${query}#Intent;scheme=plainphone;package=${packageName};S.browser_fallback_url=${fallback};end`;
}
