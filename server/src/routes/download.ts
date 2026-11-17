// SPDX-License-Identifier: Apache-2.0
//
// A stable download address for the phone app, so provisioning QR codes do not go stale with
// every release: GET /download/android redirects to the newest APK. Android's provisioning
// downloader follows redirects (GitHub's own release links already redirect to a CDN).
// The QR code pins the signing certificate, not the file, so any release signed with the
// same key passes the check.

import { Hono } from "hono";
import type { Ctx } from "../services/context.js";

/** Asset names the release workflow uploads, e.g. plainphone-0.1.4.apk. */
const APK_NAME = /^plainphone-[\w.-]+\.apk$/;
const CACHE_MS = 10 * 60_000;
const FAILURE_BACKOFF_MS = 60_000;

interface GithubRelease {
  draft?: boolean;
  published_at?: string | null;
  assets?: { name?: string; browser_download_url?: string }[];
}

/**
 * The newest published (pre-)release that has an APK, or null. Pre-releases count: every app
 * release so far is one. Only publish APKs signed with the same key (APK_SIGNATURE_CHECKSUM),
 * or QR codes made before stop working.
 */
export function newestApk(releases: GithubRelease[]): string | null {
  const candidates = releases
    .filter((r) => !r.draft && r.published_at)
    .sort((a, b) => Date.parse(b.published_at!) - Date.parse(a.published_at!));
  for (const r of candidates) {
    const asset = r.assets?.find((a) => a.name && APK_NAME.test(a.name) && a.browser_download_url?.startsWith("https://"));
    if (asset) return asset.browser_download_url!;
  }
  return null;
}

export function downloadRoutes(ctx: Ctx, fetchImpl: typeof fetch = fetch) {
  const app = new Hono();
  let cached: { url: string; at: number } | undefined;
  let failedAt = 0;
  let inflight: Promise<string | null> | undefined;

  async function lookUp(): Promise<string | null> {
    if (ctx.cfg.APK_DOWNLOAD_URL) return ctx.cfg.APK_DOWNLOAD_URL;
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.url;
    // After a failed lookup, wait a minute before asking GitHub again (its anonymous limit is 60/h).
    if (Date.now() - failedAt < FAILURE_BACKOFF_MS) return cached?.url ?? null;
    inflight ??= (async () => {
      try {
        const res = await fetchImpl(`https://api.github.com/repos/${ctx.cfg.APK_RELEASES_REPO}/releases?per_page=30`, {
          headers: { accept: "application/vnd.github+json", "user-agent": "plainphone-server" },
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
        const url = newestApk((await res.json()) as GithubRelease[]);
        if (url) cached = { url, at: Date.now() };
        else failedAt = Date.now();
        return url ?? cached?.url ?? null;
      } catch (err) {
        failedAt = Date.now();
        console.error(`APK lookup failed: ${(err as Error).message}`);
        // Keep serving the last known APK while GitHub is unreachable.
        return cached?.url ?? null;
      } finally {
        inflight = undefined;
      }
    })();
    return inflight;
  }

  app.on(["GET", "HEAD"], "/android", async (c) => {
    const url = await lookUp();
    if (!url) return c.json({ error: "no app release found" }, 503);
    c.header("Cache-Control", "no-store");
    return c.redirect(url, 302);
  });

  return app;
}
