// SPDX-License-Identifier: Apache-2.0
//
// "Alerts usually arrive within N s" from the server's public delivery stats (docs/latency.md).

export interface LatencyRow {
  path: "phone-server" | "server-parent" | "parent-device" | "server-child";
  provider: string | null;
  kind: string | null;
  samples: number;
  p50Ms: number;
  p95Ms: number;
}

export interface LatencyStats {
  enabled: boolean;
  windowDays: number;
  minSamples: number;
  paths: LatencyRow[];
}

/** The sample-weighted median of a path's rows, or null when it has none. */
function typical(rows: LatencyRow[]): number | null {
  const samples = rows.reduce((sum, r) => sum + r.samples, 0);
  return samples ? rows.reduce((sum, r) => sum + r.p50Ms * r.samples, 0) / samples : null;
}

/**
 * Typical seconds from the press on the child's phone to a parent's device: the upload plus the
 * confirmed delivery. Null without confirmed deliveries, so the dashboard never guesses.
 */
export function alertSeconds(stats: LatencyStats | null | undefined): number | null {
  if (!stats?.enabled) return null;
  const delivered = typical(stats.paths.filter((r) => r.path === "parent-device"));
  if (delivered === null) return null;
  const upload = typical(stats.paths.filter((r) => r.path === "phone-server" && r.kind === "sos")) ?? 0;
  return Math.max(1, Math.ceil((upload + delivered) / 1000));
}

/** The public stats; null when the server is older or unreachable. */
export async function fetchLatency(): Promise<LatencyStats | null> {
  try {
    const res = await fetch("/api/latency", { credentials: "omit" });
    return res.ok ? ((await res.json()) as LatencyStats) : null;
  } catch {
    return null;
  }
}
