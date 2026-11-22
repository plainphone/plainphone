// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

// Both Compose files run the app: deploy/dokploy-compose.yaml for the hosted service and
// compose.yaml for self-hosting. A server setting reaches the container only if the app service
// passes it through. The app-link settings were missing, so a server could not list a second iOS
// app (org.plainphone.parent) in apple-app-site-association or enable Android app links.
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const defaults = loadConfig({ DATABASE_URL: "unused", PUBLIC_URL: "https://app.example.test", NODE_ENV: "test" });
const KEYS = ["APPLE_APP_IDS", "ANDROID_APP_PACKAGE", "ANDROID_APP_CERT_SHA256"] as const;

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
  return service.slice(envStart + 1, envEnd < 0 ? undefined : envEnd).filter((l) => /^ {6}[A-Z_]+:/.test(l));
}

describe.each(["../../deploy/dokploy-compose.yaml", "../../compose.yaml"])("%s", (path) => {
  const env = appEnvironment(read(path));

  it.each(KEYS)("passes %s to the app service with the server's own default", (key) => {
    const line = env.find((l) => l.trim().startsWith(`${key}:`));
    expect(line, `${key} is not passed to the app container`).toBeDefined();
    expect(line!.trim()).toBe(`${key}: \${${key}:-${defaults[key]}}`);
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
      "    ports:",
      '      - "8080:8080"',
      "  backup:",
      "    environment:",
      "      ANDROID_APP_PACKAGE: ${ANDROID_APP_PACKAGE:-y}",
    ].join("\n");
    expect(appEnvironment(compose)).toEqual(["      PUBLIC_URL: ${PUBLIC_URL:?}"]);
  });
});

describe(".env.example", () => {
  it.each(KEYS)("lists %s for self-hosters", (key) => {
    expect(read("../../.env.example")).toMatch(new RegExp(`^${key}=`, "m"));
  });
});
