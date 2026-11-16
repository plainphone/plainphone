// SPDX-License-Identifier: Apache-2.0
//
// Reading tokens from incoming links. Login and invite links carry the token in the
// URL fragment (#token=…), so it never reaches server logs; Expo Router drops the
// fragment from route params, so screens read the raw URL instead.

/** The token from a link like https://app.plainphone.org/auth/app#token=pp_m_… */
export function tokenFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const hash = url.indexOf("#");
  if (hash < 0) return null;
  const params = new URLSearchParams(url.slice(hash + 1));
  const token = params.get("token");
  return token && token.length >= 10 && token.length <= 200 ? token : null;
}

/**
 * The pairing code from a scanned QR code. The phone's QR code holds
 * https://<server>/pair?code=K7MP4QXR; a bare code is accepted too.
 */
export function codeFromScan(data: string): string | null {
  const raw = data.trim();
  let code: string | null = null;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (u.pathname.replace(/\/+$/, "") !== "/pair") return null;
      code = u.searchParams.get("code");
    } catch {
      return null;
    }
  } else {
    code = raw;
  }
  if (!code) return null;
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return clean.length === 8 ? clean : null;
}
