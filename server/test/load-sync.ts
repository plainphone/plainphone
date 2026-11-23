// SPDX-License-Identifier: Apache-2.0
//
// Sync-heavy load: many phones doing what the Android app does with the screen on
// (docs/capacity.md has how to run it, scripts/load-test.sh runs it against a local copy).
// Each phone, once a minute at its own second of the minute: GET /api/device/rules with its
// ETag, then PUT /api/device/status. It also holds GET /api/device/update-request open the
// whole time, like UpdateRequestListener, and syncs again at once on a simulated push wake-up
// (a parent change), without its ETag so the server sends the full rules.
//
// Usage: tsx test/load-sync.ts --base http://127.0.0.1:PORT [--phones 500] [--minutes 10]
//          [--burst] [--wakes-per-hour 4] [--app-container NAME --db-container NAME] [--out FILE]
// Phone n uses the device token pp_d_load_<n> (scripts/load/seed.sql).
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { parseArgs, promisify } from "node:util";

const run = promisify(execFile);
const { values: opt } = parseArgs({
  options: {
    base: { type: "string" },
    phones: { type: "string", default: "500" },
    minutes: { type: "string", default: "10" },
    burst: { type: "boolean", default: false },
    "wakes-per-hour": { type: "string", default: "4" },
    "app-container": { type: "string" },
    "db-container": { type: "string" },
    out: { type: "string" },
    "pool-max": { type: "string", default: "10" },
  },
});
if (!opt.base) throw new Error("--base is required");
const base = opt.base.replace(/\/$/, "");
const phoneCount = Number(opt.phones);
const minutes = Number(opt.minutes);
const wakesPerHour = Number(opt["wakes-per-hour"]);
if (![phoneCount, minutes, wakesPerHour].every((n) => Number.isFinite(n) && n >= 0) || phoneCount < 1) {
  throw new Error("--phones, --minutes and --wakes-per-hour must be numbers");
}

type Sample = { ms: number; status: number };
const results = new Map<string, Sample[]>();
const errors = new Map<string, number>();
function record(name: string, ms: number, status: number) {
  if (!results.has(name)) results.set(name, []);
  results.get(name)!.push({ ms, status });
}

async function call(name: string, path: string, init: RequestInit & { token: string; timeoutMs?: number; cutAt?: number }) {
  const start = performance.now();
  // A long request still open when the run ends is cut there and not counted.
  const timeout = Math.min(init.timeoutMs ?? 30_000, (init.cutAt ?? Infinity) - start);
  try {
    const res = await fetch(base + path, {
      ...init,
      headers: { authorization: `Bearer ${init.token}`, ...init.headers },
      signal: AbortSignal.timeout(Math.max(1, Math.floor(timeout))),
    });
    await res.arrayBuffer();
    record(name, performance.now() - start, res.status);
    return res;
  } catch (err) {
    if (init.cutAt !== undefined && performance.now() >= init.cutAt - 5) return null;
    record(name, performance.now() - start, 0);
    const key = `${name}: ${(err as Error).name}`;
    errors.set(key, (errors.get(key) ?? 0) + 1);
    return null;
  }
}

class Phone {
  etag: string | null = null;
  busy: Promise<void> | null = null;
  firstSyncMs: number | null = null;
  readonly token: string;
  constructor(readonly n: number) {
    this.token = `pp_d_load_${n}`;
  }

  /** One sync like SyncRunner: rules first, then the status report. */
  sync(fresh: boolean): Promise<void> {
    // The app syncs one at a time; a wake-up during a sync waits for it.
    const previous = this.busy ?? Promise.resolve();
    const next = previous.then(async () => {
      const res = await call("GET /rules", "/api/device/rules", {
        token: this.token,
        headers: !fresh && this.etag ? { "if-none-match": this.etag } : {},
      });
      if (res?.ok || res?.status === 304) this.etag = res.headers.get("etag") ?? this.etag;
      if (!res || (!res.ok && res.status !== 304)) return;
      await call("PUT /status", "/api/device/status", {
        token: this.token, method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appVersion: "1.0.0", appVersionCode: 100, androidVersion: "14",
          batteryPct: 40 + (this.n % 60), charging: this.n % 5 === 0,
          deviceOwner: true, lockIntact: true, maintenance: false, failedPolicies: [],
          rulesEtag: this.etag, rulesReceiptConfirmed: true, rulesAppliedAt: new Date().toISOString(),
          dnsHost: `load${this.n}.dns.example.invalid`, mode: "strong",
          timeUsed: { "*": 30 + (this.n % 90) },
        }),
      });
      if (this.firstSyncMs === null) this.firstSyncMs = performance.now() - t0;
    });
    this.busy = next.finally(() => { if (this.busy === tracked) this.busy = null; });
    const tracked = this.busy;
    return next;
  }

  async location() {
    await call("PUT /location", "/api/device/location", {
      token: this.token, method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lat: 55.67 + this.n / 1e5, lon: 12.56, accuracyM: 20, recordedAt: new Date().toISOString(), purpose: "always" }),
    });
  }

  /** UpdateRequestListener: one long request at a time, opened again when it ends. */
  async listen(until: number) {
    while (performance.now() < until) {
      const res = await call("GET /update-request", `/api/device/update-request?after=${Date.now()}`, {
        token: this.token, timeoutMs: 65_000, cutAt: until,
      });
      if (performance.now() >= until) return;
      // The app waits before retrying a failure.
      if (!res || (res.status !== 204 && res.status !== 200)) await sleep(5_000);
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Container and database numbers, sampled every few seconds ------------------
type Snapshot = {
  t: number; appCpu: number | null; dbCpu: number | null; appMemMiB: number | null; appRssMiB: number | null;
  dbMemMiB: number | null; dbConnections: Record<string, number> | null; loadgenCpuPct: number;
};
const snapshots: Snapshot[] = [];
const mib = (s: string) => {
  const m = /^([\d.]+)\s*([KMG]i?B|B)/.exec(s.trim());
  if (!m) return null;
  const f = { B: 1 / 2 ** 20, KiB: 1 / 1024, KB: 1 / 1024, MiB: 1, MB: 1, GiB: 1024, GB: 1024 }[m[2]!] ?? 1;
  return Number(m[1]) * f;
};
async function sampleOnce(lastCpu: NodeJS.CpuUsage, lastAt: number): Promise<Snapshot> {
  const app = opt["app-container"];
  const db = opt["db-container"];
  const snap: Snapshot = {
    t: (performance.now() - t0) / 1000, appCpu: null, dbCpu: null, appMemMiB: null, appRssMiB: null,
    dbMemMiB: null, dbConnections: null, loadgenCpuPct: 0,
  };
  const cpu = process.cpuUsage(lastCpu);
  snap.loadgenCpuPct = ((cpu.user + cpu.system) / 1000 / (performance.now() - lastAt)) * 100;
  if (!app || !db) return snap;
  const [stats, rss, conns] = await Promise.allSettled([
    run("docker", ["stats", "--no-stream", "--format", "{{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}", app, db]),
    run("docker", ["exec", app, "sh", "-c", "grep VmRSS /proc/1/status"]),
    run("docker", ["exec", db, "psql", "-U", "plainphone", "-d", "plainphone", "-Atc",
      "select coalesce(state, 'none'), count(*) from pg_stat_activity where datname = 'plainphone' " +
      "and backend_type = 'client backend' and pid <> pg_backend_pid() group by 1"]),
  ]);
  if (stats.status === "fulfilled") {
    for (const line of stats.value.stdout.trim().split("\n")) {
      const [name, cpuPct, mem] = line.split("\t");
      const c = Number.parseFloat(cpuPct ?? "");
      const m = mib((mem ?? "").split("/")[0] ?? "");
      if (name === app) { snap.appCpu = c; snap.appMemMiB = m; } else { snap.dbCpu = c; snap.dbMemMiB = m; }
    }
  }
  if (rss.status === "fulfilled") {
    const kb = /VmRSS:\s+(\d+)/.exec(rss.value.stdout)?.[1];
    if (kb) snap.appRssMiB = Number(kb) / 1024;
  }
  if (conns.status === "fulfilled") {
    snap.dbConnections = Object.fromEntries(conns.value.stdout.trim().split("\n").filter(Boolean)
      .map((l) => { const [s, n] = l.split("|"); return [s!, Number(n)]; }));
  }
  return snap;
}
async function sampler(until: number) {
  let lastCpu = process.cpuUsage();
  let lastAt = performance.now();
  while (performance.now() < until) {
    const snap = await sampleOnce(lastCpu, lastAt);
    lastCpu = process.cpuUsage();
    lastAt = performance.now();
    snapshots.push(snap);
    await sleep(2_000);
  }
}

// --- Run -------------------------------------------------------------------------
const phones = Array.from({ length: phoneCount }, (_, i) => new Phone(i + 1));
const t0 = performance.now();
const end = t0 + minutes * 60_000;
const offsets = phones.map(() => Math.random() * 60_000);

const work: Promise<unknown>[] = [sampler(end)];
for (const [i, phone] of phones.entries()) {
  // A burst is every phone coming back at the same moment, as after a server restart:
  // the long request reconnects and the first sync goes out without waiting for its slot.
  work.push((async () => {
    // Steady state: the phones were already connected, so their reconnects are spread out too.
    if (!opt.burst) await sleep(offsets[i]!);
    await phone.listen(end);
  })());
  work.push((async () => {
    if (opt.burst) await phone.sync(true);
    let next = t0 + offsets[i]!;
    if (opt.burst) next += 60_000;
    while (next < end) {
      await sleep(Math.max(0, next - performance.now()));
      await phone.sync(false);
      next += 60_000;
    }
  })());
  // Push wake-ups: a parent change arrives as a Poisson process per phone.
  if (wakesPerHour > 0) work.push((async () => {
    for (;;) {
      const wait = -Math.log(1 - Math.random()) * (3_600_000 / wakesPerHour);
      if (performance.now() + wait >= end) return;
      await sleep(wait);
      await phone.sync(true);
    }
  })());
  // Every third phone has location "always" in the seed: one position every 5 minutes.
  if ((i + 1) % 3 === 0) work.push((async () => {
    let next = t0 + Math.random() * 300_000;
    while (next < end) {
      await sleep(Math.max(0, next - performance.now()));
      await phone.location();
      next += 300_000;
    }
  })());
}
await Promise.all(work);
const seconds = (performance.now() - t0) / 1000;

// --- Report ------------------------------------------------------------------------
function pct(sorted: number[], p: number) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}
const round = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
const endpoints = Object.fromEntries([...results].map(([name, samples]) => {
  const ok = samples.filter((s) => s.status >= 200 && s.status < 400);
  // The long request is held open on purpose; its duration is not a latency.
  const ms = ok.map((s) => s.ms).sort((a, b) => a - b);
  const byStatus: Record<string, number> = {};
  for (const s of samples) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  return [name, {
    requests: samples.length,
    perMinute: Math.round((samples.length / seconds) * 60),
    errorRate: round(((samples.length - ok.length) / samples.length) * 100),
    statuses: byStatus,
    ...(name === "GET /update-request" ? {} : {
      p50: round(pct(ms, 50)), p95: round(pct(ms, 95)), p99: round(pct(ms, 99)), max: round(ms.at(-1) ?? null),
    }),
  }];
}));
const peak = (f: (s: Snapshot) => number | null) => {
  const v = snapshots.map(f).filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? round(Math.max(...v)) : null;
};
const avg = (f: (s: Snapshot) => number | null) => {
  const v = snapshots.map(f).filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};
const total = (s: Snapshot) => (s.dbConnections ? Object.values(s.dbConnections).reduce((a, b) => a + b, 0) : null);
const firstSync = phones.map((p) => p.firstSyncMs).filter((x): x is number => x !== null).sort((a, b) => a - b);
const report = {
  mode: opt.burst ? "burst" : "steady",
  phones: phoneCount, minutes, wakesPerHour, seconds: round(seconds),
  machine: { cpus: cpus().length, cpuModel: cpus()[0]?.model, ramGiB: round(totalmem() / 2 ** 30) },
  endpoints,
  errors: Object.fromEntries(errors),
  app: {
    rssPeakMiB: peak((s) => s.appRssMiB), rssLastMiB: round(snapshots.at(-1)?.appRssMiB ?? null),
    cgroupPeakMiB: peak((s) => s.appMemMiB), limitMiB: 768,
    cpuAvgPct: avg((s) => s.appCpu), cpuPeakPct: peak((s) => s.appCpu),
  },
  db: {
    connectionsPeak: peak(total), connectionsAvg: avg(total),
    activePeak: peak((s) => s.dbConnections?.active ?? 0), poolMax: Number(opt["pool-max"]),
    cpuAvgPct: avg((s) => s.dbCpu), cpuPeakPct: peak((s) => s.dbCpu), memPeakMiB: peak((s) => s.dbMemMiB),
  },
  loadgen: { cpuAvgPct: avg((s) => s.loadgenCpuPct) },
  ...(opt.burst ? {
    burst: {
      phonesSynced: firstSync.length,
      allSyncedAfterS: round((firstSync.at(-1) ?? NaN) / 1000),
      p50SyncedAfterS: round((pct(firstSync, 50) ?? NaN) / 1000),
      p95SyncedAfterS: round((pct(firstSync, 95) ?? NaN) / 1000),
    },
  } : {}),
  timeline: snapshots.map((s) => ({ ...s, t: round(s.t) })),
};
const { timeline: _timeline, ...summary } = report;
console.log(JSON.stringify(summary, null, 2));
if (opt.out) await writeFile(opt.out, JSON.stringify(report, null, 2) + "\n");
