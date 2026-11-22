// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

// Dokploy runs deploy/dokploy-compose.yaml: a server setting reaches the container only if the
// app service passes it through. The app-link settings were missing, so the hosted server could
// not list a second iOS app (org.plainphone.parent) in apple-app-site-association.
const compose = readFileSync(fileURLToPath(new URL("../../deploy/dokploy-compose.yaml", import.meta.url)), "utf8");
const defaults = loadConfig({ DATABASE_URL: "unused", PUBLIC_URL: "https://app.example.test", NODE_ENV: "test" });

describe("deploy/dokploy-compose.yaml", () => {
  it.each(["APPLE_APP_IDS", "ANDROID_APP_PACKAGE", "ANDROID_APP_CERT_SHA256"] as const)(
    "passes %s through with the server's own default",
    (key) => {
      const line = compose.split("\n").find((l) => l.trim().startsWith(`${key}:`));
      expect(line, `${key} is not passed to the app container`).toBeDefined();
      expect(line!.trim()).toBe(`${key}: \${${key}:-${defaults[key]}}`);
    },
  );
});
