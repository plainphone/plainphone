// SPDX-License-Identifier: Apache-2.0
//
// A stable download address for the phone app, so provisioning QR codes do not go stale with
// every release: GET /download/android redirects to the newest APK. Android's provisioning
// downloader follows redirects (GitHub's own release links already redirect to a CDN).
// The QR code pins the signing certificate, not the file, so any release signed with the
// same key passes the check.

import { Hono } from "hono";
import { z } from "zod";
import type { Ctx } from "../services/context.js";

/** Asset names the release workflow uploads, e.g. plainphone-0.1.4.apk. */
const APK_NAME = /^plainphone-[\w.-]+\.apk$/;
const CACHE_MS = 10 * 60_000;
const FAILURE_BACKOFF_MS = 60_000;

interface Asset {
  name?: string;
  browser_download_url?: string;
  digest?: string | null;
}

interface Download {
  url: string;
  metadataUrl?: string;
  digest?: string | null;
}

const releaseMetadata = z.object({
  versionCode: z.number().int().positive(),
  versionName: z.string().min(1).max(40),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

interface GithubRelease {
  draft?: boolean;
  published_at?: string | null;
  assets?: Asset[];
}

/**
 * The newest published (pre-)release that has an APK, or null. Pre-releases count: every app
 * release so far is one. Only publish APKs signed with the same key (APK_SIGNATURE_CHECKSUM),
 * or QR codes made before stop working.
 */
export function newestApk(releases: GithubRelease[]): string | null {
  return newestDownload(releases)?.url ?? null;
}

function newestDownload(releases: GithubRelease[]): Download | null {
  const candidates = releases
    .filter((r) => !r.draft && r.published_at)
    .sort((a, b) => Date.parse(b.published_at!) - Date.parse(a.published_at!));
  for (const r of candidates) {
    const asset = r.assets?.find((a) => a.name && APK_NAME.test(a.name) && a.browser_download_url?.startsWith("https://"));
    if (asset) {
      const metadata = r.assets?.find((a) => a.name === `${asset.name}.json` && a.browser_download_url?.startsWith("https://"));
      return { url: asset.browser_download_url!, metadataUrl: metadata?.browser_download_url, digest: asset.digest };
    }
  }
  return null;
}

export function downloadRoutes(ctx: Ctx, fetchImpl: typeof fetch = fetch) {
  const app = new Hono();
  let cached: { download: Download; at: number } | undefined;
  let failedAt = 0;
  let inflight: Promise<Download | null> | undefined;

  async function lookUp(): Promise<Download | null> {
    if (ctx.cfg.APK_DOWNLOAD_URL) return { url: ctx.cfg.APK_DOWNLOAD_URL, metadataUrl: ctx.cfg.APK_METADATA_URL };
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.download;
    // After a failed lookup, wait a minute before asking GitHub again (its anonymous limit is 60/h).
    if (Date.now() - failedAt < FAILURE_BACKOFF_MS) return cached?.download ?? null;
    inflight ??= (async () => {
      try {
        const res = await fetchImpl(`https://api.github.com/repos/${ctx.cfg.APK_RELEASES_REPO}/releases?per_page=30`, {
          headers: { accept: "application/vnd.github+json", "user-agent": "plainphone-server" },
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
        const download = newestDownload((await res.json()) as GithubRelease[]);
        if (download) cached = { download, at: Date.now() };
        else failedAt = Date.now();
        return download ?? cached?.download ?? null;
      } catch (err) {
        failedAt = Date.now();
        console.error(`APK lookup failed: ${(err as Error).message}`);
        // Keep serving the last known APK while GitHub is unreachable.
        return cached?.download ?? null;
      } finally {
        inflight = undefined;
      }
    })();
    return inflight;
  }

  app.on(["GET", "HEAD"], "/android", async (c) => {
    const download = await lookUp();
    if (!download) return c.json({ error: "no app release found" }, 503);
    c.header("Cache-Control", "no-store");
    return c.redirect(download.url, 302);
  });

  let metadataCache: { key: string; at: number; result: Promise<z.infer<typeof releaseMetadata>> } | undefined;
  app.get("/android/latest.json", async (c) => {
    const download = await lookUp();
    if (!download) return c.json({ error: "no app release found" }, 503);
    if (!download.metadataUrl) return c.json({ error: "release has no metadata" }, 404);
    const key = JSON.stringify(download);
    try {
      if (metadataCache?.key !== key || Date.now() - metadataCache.at >= CACHE_MS) {
        const metadataUrl = download.metadataUrl;
        const result = (async () => {
          const response = await fetchImpl(metadataUrl, { signal: AbortSignal.timeout(5_000) });
          if (!response.ok) throw new Error(`metadata answered ${response.status}`);
          const info = releaseMetadata.parse(await response.json());
          if (download.digest && download.digest !== `sha256:${info.sha256}`) {
            throw new Error("metadata digest differs from GitHub's APK digest");
          }
          return info;
        })();
        metadataCache = { key, result, at: Date.now() };
      }
      return c.json({ ...await metadataCache.result, url: download.url });
    } catch {
      if (metadataCache?.key === key) metadataCache = undefined;
      return c.json({ error: "release metadata is unavailable" }, 503);
    }
  });

  return app;
}
