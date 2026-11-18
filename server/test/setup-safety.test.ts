// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { sweep } from "../src/services/sweeper.js";
import { Client, signIn, useHarness } from "./harness.js";

describe("onboarding safety", () => {
  const h = useHarness();

  async function start(account?: Client, mode: "light" | "strong" = "light") {
    const parent = account ?? await signIn(h, "claimer@example.org");
    const device = new Client(h);
    const result = await device.post("/api/device/pairings", { mode, profile: "self", confirmOnPhone: true });
    expect(result.status).toBe(201);
    const { code, pairingId, pollSecret } = result.json;
    const path = `/api/device/pairings/${pairingId}`;
    const headers = { "x-poll-secret": pollSecret };
    return {
      parent, device, code,
      poll: () => device.get(path, headers),
      decide: (action: string) => device.call("POST", path, { action }, headers),
      claim: (profile = "self") => parent.post("/api/phones/claim", { code, profile, name: "My phone" }),
    };
  }

  it("requires matching dashboard choice and shows only the masked account before releasing the token", async () => {
    const { parent, device, code, poll, decide, claim } = await start();
    expect((await poll()).json).toEqual({ status: "waiting" });
    expect((await parent.post("/api/phones/pairing-profile", { code })).json).toEqual({ profile: "self" });
    expect((await claim("child")).status).toBe(409);
    const claimed = await claim();
    expect(claimed.status).toBe(201);
    expect(claimed.json.pairedAt).toBeNull();
    expect((await poll()).json).toEqual({
      status: "confirm",
      maskedEmail: "c***@example.org",
      householdName: (await parent.get("/api/me")).json.households[0].name,
    });
    const confirmed = await decide("confirm");
    expect(confirmed.status).toBe(200);
    expect((await decide("confirm")).json.deviceToken).toBe(confirmed.json.deviceToken);
    expect((await poll()).json.deviceToken).toBe(confirmed.json.deviceToken);
    device.token = confirmed.json.deviceToken;
    expect((await device.get("/api/device/rules")).status).toBe(200);
  });

  it("removes a light phone and sends one notice even after a delayed or duplicate report", async () => {
    const { parent, device, decide, claim } = await start();
    const claimed = await claim();
    device.token = (await decide("confirm")).json.deviceToken;
    h.clock.advance(3 * 24 * 60 * 60_000);
    const before = h.mail.outbox.length;
    const path = "/api/device/undo-setup";
    const reports = await Promise.all([device.post(path), device.post(path)]);
    expect(reports.map(({ status }) => status)).toContain(204);
    expect((await device.post(path)).status).toBe(401);
    expect((await parent.get(`/api/phones/${claimed.json.id}`)).status).toBe(404);
    const notices = h.mail.outbox.slice(before);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.to).toBe("claimer@example.org");
    expect(notices[0]?.text).toContain("Set-up was undone on the phone");
  });

  it("keeps Device Owner paired when it reports a setup undo", async () => {
    const { parent, device, decide, claim } = await start(undefined, "strong");
    const claimed = await claim();
    device.token = (await decide("confirm")).json.deviceToken;
    const before = h.mail.outbox.length;
    expect((await device.post("/api/device/undo-setup")).status).toBe(409);
    expect((await parent.get(`/api/phones/${claimed.json.id}`)).status).toBe(200);
    expect(h.mail.outbox).toHaveLength(before);
  });

  it("recovers a lost confirmation response across the original code expiry", async () => {
    const { device, poll, decide, claim } = await start();
    await claim();
    h.clock.advance(14 * 60_000);
    const confirmed = await decide("confirm");
    h.clock.advance(2 * 60_000);
    await sweep(h.ctx);
    expect((await poll()).json.deviceToken).toBe(confirmed.json.deviceToken);
    device.token = confirmed.json.deviceToken;
    expect((await device.get("/api/device/rules")).status).toBe(200);
  });

  it("removes the pending phone and code when the phone cancels", async () => {
    const { parent, poll, decide, claim } = await start();
    const claimed = await claim();
    expect((await decide("cancel")).status).toBe(204);
    expect((await poll()).status).toBe(404);
    expect((await claim()).status).toBe(404);
    expect((await parent.get(`/api/phones/${claimed.json.id}`)).status).toBe(404);
  });

  it("sweeps an expired pending claim without removing a connected phone", async () => {
    const pending = await start();
    const connected = await start(pending.parent);
    const abandoned = await pending.claim();
    const kept = await connected.claim();
    const confirmed = await connected.decide("confirm");
    expect(confirmed.status).toBe(200);
    connected.device.token = confirmed.json.deviceToken;
    expect((await connected.device.get("/api/device/rules")).status).toBe(200);
    const neverSynced = await start(pending.parent);
    const neverSyncedPhone = await neverSynced.claim();
    expect((await neverSynced.decide("confirm")).status).toBe(200);
    h.clock.advance(16 * 60_000);
    expect((await pending.poll()).status).toBe(410);
    await sweep(h.ctx);
    expect((await pending.parent.get(`/api/phones/${abandoned.json.id}`)).status).toBe(404);
    expect((await connected.parent.get(`/api/phones/${kept.json.id}`)).status).toBe(200);
    h.clock.advance(24 * 60 * 60_000);
    expect((await neverSynced.poll()).status).toBe(410);
    await sweep(h.ctx);
    expect((await pending.parent.get(`/api/phones/${neverSyncedPhone.json.id}`)).status).toBe(404);
    expect((await connected.parent.get(`/api/phones/${kept.json.id}`)).status).toBe(200);
  });

  it("identifies the claimer rather than a different member of the same household", async () => {
    const owner = await signIn(h, "owner@example.org");
    const household = (await owner.get("/api/me")).json.households[0];
    await owner.post(`/api/households/${household.id}/invites`, { email: "claimer@example.org" });
    const token = decodeURIComponent(/invite#token=(\S+)/.exec(h.mail.outbox.at(-1)!.text)![1]!);
    const { parent, code, poll } = await start();
    expect((await parent.post("/api/invites/accept", { token })).status).toBe(200);
    expect((await parent.post("/api/phones/claim", {
      code, name: "My phone", profile: "self", householdId: household.id,
    })).status).toBe(201);
    expect((await poll()).json).toEqual({
      status: "confirm", maskedEmail: "c***@example.org", householdName: household.name,
    });
  });

  it("reviews and cancels a light-mode setup link before redemption", async () => {
    const parent = await signIn(h, "claimer@example.org");
    const device = new Client(h);
    const made = await parent.post("/api/phones/enroll", { mode: "light", name: "My phone", profile: "self" });
    expect(made.status).toBe(201);
    const { token } = made.json.enrollment;
    const path = "/api/device/enrollment-review";
    expect((await device.post(path, { token, mode: "strong" })).status).toBe(404);
    expect((await device.post(path, { token, mode: "light" })).json).toMatchObject({ maskedEmail: "c***@example.org", profile: "self" });
    expect((await device.post(path, { token, mode: "light", cancel: true })).status).toBe(204);
    expect((await device.post(path, { token, mode: "light" })).status).toBe(404);
    expect((await parent.get(`/api/phones/${made.json.phone.id}`)).status).toBe(404);
  });
});
