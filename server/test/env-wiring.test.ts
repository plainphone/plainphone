// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONFIG_KEYS, loadConfig } from "../src/config.js";

// Both Compose files list the app's environment one variable at a time: compose.yaml for
// self-hosting, deploy/dokploy-compose.yaml for the hosted service. A variable the file does not
// pass never reaches the container, so setting it in Dokploy or .env does nothing. That happened
// to the app links, SIGNUP_DAILY_CAP and REVIEW_LOGIN_* (#267). This guard keeps every setting the
// server reads (src/config.ts) and every one docs/self-hosting.md documents wired up, or listed
// below with the reason it is not.

type File = "compose" | "dokploy";
const FILES: Record<File, string> = { compose: "compose.yaml", dokploy: "deploy/dokploy-compose.yaml" };

/** Settings a Compose file deliberately does not pass, and why. */
const NOT_PASSED: Record<string, { files: File[]; reason: string }> = {
  NODE_ENV: { files: ["compose", "dokploy"], reason: "the image sets production (Dockerfile)" },
  PORT: { files: ["compose", "dokploy"], reason: "the image sets 8080 and both files publish that port" },
  WEB_DIST: { files: ["compose", "dokploy"], reason: "the image sets the path of the built PWA it contains" },
  E2EE_PROTOTYPE_ENABLED: {
    files: ["compose", "dokploy"],
    reason: "always off with NODE_ENV=production, which the image sets (docs/e2ee-prototype.md)",
  },
  PAYMENTS_ENABLED: { files: ["compose", "dokploy"], reason: "unused, replaced by billing (docs/billing.md)" },
  ...Object.fromEntries(
    CONFIG_KEYS.filter((k) => /^(BILLING|STRIPE|PLAY)_/.test(k)).map((k) => [
      k,
      { files: ["compose"] as File[], reason: "billing is for the hosted service; self-hosted servers keep it off (docs/billing.md)" },
    ]),
  ),
};

/** Values that are not `${KEY:-default}` / `${KEY:?}`, and why. */
const FIXED: Record<File, Record<string, string>> = {
  compose: { DATABASE_URL: "points at the db service" },
  dokploy: {
    DATABASE_URL: "points at the db service",
    DNS_HOST_SUFFIX: "the hosted service's DNS hosts",
    TRUST_PROXY: "Traefik sits in front",
  },
};

/** `${KEY:-default}` lines whose default deliberately differs from the server's. */
const OWN_DEFAULT: Record<File, Record<string, string>> = {
  compose: { MAIL_FROM: "a self-hosted server must not send as plainphone.org" },
  dokploy: {},
};

/** Variables compose.yaml reads that .env.example does not list, and why. */
const NOT_IN_ENV_EXAMPLE: Record<string, string> = {
  REVIEW_LOGIN_EMAIL: "app store review on the hosted service only (docs/store-review.md)",
  REVIEW_LOGIN_CODE: "app store review on the hosted service only (docs/store-review.md)",
};

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");

/** The lines of the `app` service's `environment:` map, by indentation (no YAML parser in the repo). */
function appEnvironment(compose: string): string[] {
  const lines = compose.split("\n");
  const start = lines.findIndex((l) => /^ {2}app:\s*$/.test(l));
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && /^ {0,2}\S/.test(l));
  const service = lines.slice(start + 1, end < 0 ? undefined : end);
  const envStart = service.findIndex((l) => /^ {4}environment:\s*$/.test(l));
  if (envStart < 0) return [];
  const envEnd = service.findIndex((l, i) => i > envStart && /^ {0,4}\S/.test(l));
  return service.slice(envStart + 1, envEnd < 0 ? undefined : envEnd).filter((l) => /^ {6}[A-Z][A-Z0-9_]*:/.test(l));
}

/** Variables in the first column of the table under "## Configuration". */
function documentedKeys(doc: string): string[] {
  const section = doc.split(/^## /m).find((s) => s.startsWith("Configuration\n")) ?? "";
  return section
    .split("\n")
    .filter((l) => l.startsWith("| `"))
    .flatMap((l) => [...l.split("|")[1]!.matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map((m) => m[1]!));
}

const BASE = { DATABASE_URL: "unused", PUBLIC_URL: "https://app.example.test", NODE_ENV: "test" };
const DEFAULTS = loadConfig(BASE) as unknown as Record<string, unknown>;
/** The server treats an empty optional string like an unset one. */
const norm = (v: unknown) => (v === "" ? undefined : v);

/** Everything wrong with the wiring, one line each. Empty when all is well. */
function wiringProblems(input: { compose: string; dokploy: string; doc: string; envExample: string }): string[] {
  const problems: string[] = [];
  const known = new Set<string>(CONFIG_KEYS);
  const passed: Record<File, Set<string>> = { compose: new Set(), dokploy: new Set() };

  for (const file of ["compose", "dokploy"] as const) {
    const name = FILES[file];
    for (const line of appEnvironment(input[file])) {
      const [, key, value] = /^ {6}([A-Z][A-Z0-9_]*):\s*(.*)$/.exec(line)!;
      passed[file].add(key!);
      if (!known.has(key!)) problems.push(`${name}: ${key} is not a setting in server/src/config.ts`);
      if (NOT_PASSED[key!]?.files.includes(file)) problems.push(`${name}: ${key} is passed but listed in NOT_PASSED`);
      if (FIXED[file][key!] !== undefined) continue;
      if (new RegExp(`^\\$\\{${key}:\\?.*\\}$`).test(value!)) continue; // required, no default
      const m = new RegExp(`^\\$\\{${key}:-(.*)\\}$`).exec(value!);
      if (!m) {
        problems.push(`${name}: ${key} must be \${${key}:-<default>} or \${${key}:?}, or listed in FIXED`);
        continue;
      }
      if (OWN_DEFAULT[file][key!] !== undefined) continue;
      // An unset variable must mean what it means without the Compose file: the server's own default.
      let effective: unknown;
      try {
        effective = (loadConfig({ ...BASE, [key!]: m[1] }) as unknown as Record<string, unknown>)[key!];
      } catch (err) {
        problems.push(`${name}: the default of ${key} (${JSON.stringify(m[1])}) stops the server: ${String(err)}`);
        continue;
      }
      if (JSON.stringify(norm(effective)) !== JSON.stringify(norm(DEFAULTS[key!]))) {
        problems.push(`${name}: the default of ${key} gives ${JSON.stringify(effective)}, the server's is ${JSON.stringify(DEFAULTS[key!])}`);
      }
    }
  }

  const required = new Set<string>([...CONFIG_KEYS, ...documentedKeys(input.doc)]);
  for (const key of required) {
    if (!known.has(key)) problems.push(`docs/self-hosting.md: ${key} is not a setting in server/src/config.ts`);
    for (const file of ["compose", "dokploy"] as const) {
      if (!passed[file].has(key) && !NOT_PASSED[key]?.files.includes(file)) {
        problems.push(`${FILES[file]}: ${key} is not passed to the app (pass it, or add it to NOT_PASSED with a reason)`);
      }
    }
  }

  // .env.example is what self-hosters copy: it lists what compose.yaml reads, and nothing else.
  const listed = new Set([...input.envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!));
  const readByCompose = new Set([...input.compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)[:}]/g)].map((m) => m[1]!));
  for (const key of readByCompose) {
    if (!listed.has(key) && NOT_IN_ENV_EXAMPLE[key] === undefined) problems.push(`.env.example: ${key} is missing`);
  }
  for (const key of listed) {
    if (!readByCompose.has(key)) problems.push(`.env.example: ${key} is not read by compose.yaml, so setting it does nothing`);
  }
  return problems;
}

const real = () => ({
  compose: read(FILES.compose),
  dokploy: read(FILES.dokploy),
  doc: read("docs/self-hosting.md"),
  envExample: read(".env.example"),
});

describe("environment wiring", () => {
  it("passes every server setting through both Compose files with the server's defaults", () => {
    expect(wiringProblems(real())).toEqual([]);
  });

  it("gives every exception a reason", () => {
    for (const [key, { files, reason }] of Object.entries(NOT_PASSED)) {
      expect(CONFIG_KEYS, key).toContain(key);
      expect(files.length, key).toBeGreaterThan(0);
      expect(reason.length, key).toBeGreaterThan(10);
    }
  });

  it("reads the documented table", () => {
    const keys = documentedKeys(real().doc);
    expect(keys).toContain("MIGRATE_ON_START");
    expect(keys).toContain("REVIEW_LOGIN_CODE");
    expect(keys).toContain("GOOGLE_OAUTH_CLIENT_SECRET");
  });
});

describe("the guard catches", () => {
  const drop = (text: string, key: string) => text.replace(new RegExp(`^.*\\b${key}[:=].*\\n`, "m"), "");

  it.each(["LATENCY_STATS", "MIGRATE_ON_START", "REVIEW_LOGIN_EMAIL", "DNS_PROVIDER"])(
    "%s removed from a Compose file",
    (key) => {
      const files = real();
      expect(wiringProblems({ ...files, dokploy: drop(files.dokploy, key) })).toContain(
        `deploy/dokploy-compose.yaml: ${key} is not passed to the app (pass it, or add it to NOT_PASSED with a reason)`,
      );
      expect(wiringProblems({ ...files, compose: drop(files.compose, key) }).some((p) => p.startsWith(`compose.yaml: ${key} `))).toBe(true);
    },
  );

  it("a default that changes what an unset variable means", () => {
    const files = real();
    const empty = files.compose.replace("${MIGRATE_ON_START:-true}", "${MIGRATE_ON_START:-}");
    expect(wiringProblems({ ...files, compose: empty })).toEqual([
      expect.stringMatching(/^compose\.yaml: the default of MIGRATE_ON_START \(""\) stops the server/),
    ]);
    const off = files.dokploy.replace("${LATENCY_STATS:-on}", "${LATENCY_STATS:-off}");
    expect(wiringProblems({ ...files, dokploy: off })).toEqual([
      'deploy/dokploy-compose.yaml: the default of LATENCY_STATS gives "off", the server\'s is "on"',
    ]);
  });

  it("a variable the server does not read", () => {
    const files = real();
    const extra = files.dokploy.replace("      METRICS_TOKEN:", "      METRICS_TOKN: ${METRICS_TOKN:-}\n      METRICS_TOKEN:");
    expect(wiringProblems({ ...files, dokploy: extra })).toEqual([
      "deploy/dokploy-compose.yaml: METRICS_TOKN is not a setting in server/src/config.ts",
    ]);
  });

  it("a documented variable that is not wired", () => {
    const files = real();
    const doc = files.doc.replace("| `TRUST_PROXY` |", "| `TRUST_PROXY`, `NOT_A_SETTING` |");
    expect(wiringProblems({ ...files, doc })).toContain("docs/self-hosting.md: NOT_A_SETTING is not a setting in server/src/config.ts");
  });

  it("a gap in .env.example, either way", () => {
    const files = real();
    expect(wiringProblems({ ...files, envExample: drop(files.envExample, "METRICS_TOKEN") })).toEqual([
      ".env.example: METRICS_TOKEN is missing",
    ]);
    expect(wiringProblems({ ...files, envExample: `${files.envExample}UNUSED_THING=1\n` })).toEqual([
      ".env.example: UNUSED_THING is not read by compose.yaml, so setting it does nothing",
    ]);
  });
});

describe("appEnvironment", () => {
  it("only reads the app service's environment", () => {
    const compose = [
      "services:",
      "  db:",
      "    environment:",
      "      APPLE_APP_IDS: ${APPLE_APP_IDS:-x}",
      "  app:",
      "    build: .",
      "    environment:",
      "      PUBLIC_URL: ${PUBLIC_URL:?}",
      "      # a comment inside the map",
      "      ANDROID_APP_CERT_SHA256: ${ANDROID_APP_CERT_SHA256:-}",
      "    ports:",
      '      - "8080:8080"',
      "  backup:",
      "    environment:",
      "      ANDROID_APP_PACKAGE: ${ANDROID_APP_PACKAGE:-y}",
    ].join("\n");
    expect(appEnvironment(compose)).toEqual([
      "      PUBLIC_URL: ${PUBLIC_URL:?}",
      "      ANDROID_APP_CERT_SHA256: ${ANDROID_APP_CERT_SHA256:-}",
    ]);
  });
});
