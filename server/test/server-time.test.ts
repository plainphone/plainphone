// SPDX-License-Identifier: Apache-2.0
// Every /device answer carries the server's clock, so a light-mode phone can keep school time and
// bedtime on a time the child cannot set (docs/light-mode.md, "The phone's clock").
import { expect, it } from "vitest";
import { Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

it("sends the server time with the rules, also when they are unchanged", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { device } = await pairPhone(h, parent);
  h.clock.now = new Date("2026-11-21T20:15:30.250Z");
  const first = await device.get("/api/device/rules");
  expect(first.status).toBe(200);
  expect(first.headers.get("x-server-time")).toBe(String(h.clock.now.getTime()));

  h.clock.advance(90_000);
  const again = await device.get("/api/device/rules", { "If-None-Match": first.headers.get("etag")! });
  expect(again.status).toBe(304);
  expect(again.headers.get("x-server-time")).toBe(String(h.clock.now.getTime()));
});

it("sends the server time with an error answer too", async () => {
  h.clock.now = new Date("2026-11-21T06:00:00.000Z");
  const stranger = new Client(h);
  stranger.token = "pp_d_unknown";
  const res = await stranger.get("/api/device/rules");
  expect(res.status).toBe(401);
  expect(res.headers.get("x-server-time")).toBe(String(h.clock.now.getTime()));
});
