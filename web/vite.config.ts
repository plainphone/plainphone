// SPDX-License-Identifier: Apache-2.0
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // PLAINPHONE_API_URL points the dev server at an API on another port (web/scripts/onboarding-walk.sh).
    proxy: { "/api": { target: process.env.PLAINPHONE_API_URL ?? "http://localhost:8080", changeOrigin: false } },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    // The server's CSP is script-src 'self': never inline anything.
    assetsInlineLimit: 0,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
