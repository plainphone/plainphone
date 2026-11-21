// SPDX-License-Identifier: Apache-2.0
//
// "Alerts usually arrive within N s" from the server's public delivery stats (docs/latency.md).

export interface LatencyRow {
  path: "phone-server" | "server-parent" | "parent-device" | "server-child";
  provider: string | null;
  kind: string | null;
  p50Ms: number;
  p95Ms: number;
}

export interface LatencyStats {
  enabled: boolean;
  windowDays: number;
  minSamples: number;
  paths: LatencyRow[];
}

/**
 * The slowest provider's median, or null when a path has no rows. The server leaves out sample
 * counts (they would show when a single SOS happened), so the line errs on the slow side.
 */
function typical(rows: LatencyRow[]): number | null {
  return rows.length ? Math.max(...rows.map((r) => r.p50Ms)) : null;
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
