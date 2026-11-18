// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { sweep } from "../src/services/sweeper.js";
import { Client, signIn, useHarness } from "./harness.js";

describe("onboarding safety", () => {
  const h = useHarness();

  async function start(account?: Client, profile = "self") {
    const parent = account ?? await signIn(h, "claimer@example.org");
    const device = new Client(h);
    const result = await device.post("/api/device/pairings", { mode: "light", profile, confirmOnPhone: true });
    expect(result.status).toBe(201);
    const { code, pairingId, pollSecret } = result.json;
    const path = `/api/device/pairings/${pairingId}`;
    const headers = { "x-poll-secret": pollSecret };
    return {
      parent, device, code,
      poll: () => device.get(path, headers),
      decide: (action: string, key?: object) => device.call("POST", path, { action, key }, headers),
      claim: (choice = profile) => parent.post("/api/phones/claim", { code, profile: choice, name: "My phone" }),
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
    expect((await device.post("/api/device/undo-setup")).status).toBe(409);
    expect((await device.post("/api/device/setup-completion", { elapsedMs: 0 })).json).toEqual({ undoRemainingMs: 600_000 });
    expect((await device.post("/api/device/undo-setup/authorize")).status).toBe(204);
    h.clock.advance(600_000);
    expect((await device.post("/api/device/undo-setup/authorize")).status).toBe(204);
    expect((await device.post("/api/device/undo-setup")).status).toBe(204);
    expect((await parent.get(`/api/phones/${claimed.json.id}`)).status).toBe(404);
    expect(h.mail.outbox.at(-1)?.to).toBe("claimer@example.org");
  });

  it.each([0, 5, 10, 30, 60])("persists a Self undo window of %i minutes", async (minutes) => {
    const { parent, device, decide, claim } = await start();
    const claimed = await claim();
    device.token = (await decide("confirm")).json.deviceToken;
    await device.get("/api/device/rules");
    expect((await device.post("/api/device/setup-completion", { elapsedMs: 0, undoMinutes: 61 })).status).toBe(400);
    expect((await device.post("/api/device/setup-completion", { elapsedMs: 0, undoMinutes: minutes })).json.undoRemainingMs)
      .toBe(minutes * 60_000);
    h.clock.advance(minutes * 60_000);
    expect((await device.post("/api/device/undo-setup/authorize")).status).toBe(409);
    expect((await parent.put(`/api/phones/${claimed.json.id}/setup-undo`, { minutes: 60 })).status).toBe(409);
    expect((await device.post("/api/device/setup-completion", { elapsedMs: 0, undoMinutes: 60 })).json.undoRemainingMs).toBe(0);
  });

  it.each([undefined, 5])("uses the dashboard's child choice (%s), never the child's", async (minutes) => {
    const { parent, device, decide, claim } = await start(undefined, "child");
    const { json } = await claim();
    if (minutes !== undefined) {
      expect((await parent.put(`/api/phones/${json.id}/setup-undo`, { minutes })).status).toBe(200);
    }
    device.token = (await decide("confirm")).json.deviceToken;
    await device.get("/api/device/rules");
    expect((await device.post("/api/device/setup-completion", { elapsedMs: 0, undoMinutes: 60 })).json.undoRemainingMs)
      .toBe((minutes ?? 10) * 60_000);
  });

  it("sets the explicitly chosen wait time before a Self phone activates", async () => {
    const { parent, device, decide, claim } = await start();
    const claimed = await claim();
    expect((await decide("confirm", { keyType: "delay", delayHours: 2 })).status).toBe(400);
    const confirmed = await decide("confirm", { keyType: "delay", delayHours: 6 });
    expect(confirmed.status).toBe(200);
    expect((await decide("confirm", { keyType: "delay", delayHours: 1 })).status).toBe(200);
    device.token = confirmed.json.deviceToken;
    await device.get("/api/device/rules");
    expect((await parent.get(`/api/phones/${claimed.json.id}/key`)).json.delayHours).toBe(6);
  });

  it("accepts a setup QR once as a separate account and sends email invitations for an email choice", async () => {
    const qr = await start();
    const { json: phone } = await qr.claim();
    qr.device.token = (await qr.decide("confirm", { keyType: "trustedQr" })).json.deviceToken;
    await qr.device.get("/api/device/rules");
    expect((await qr.device.post("/api/device/trusted-invite")).status).toBe(201);
    const invite = await qr.parent.post(`/api/phones/${phone.id}/trusted-invite`);
    const token = new URLSearchParams(new URL(invite.json.url).hash.slice(1)).get("token");
    expect((await qr.parent.post("/api/invites/accept", { token })).status).toBe(400);
    const helper = await signIn(h, "new-helper@example.org");
    expect((await helper.post("/api/invites/accept", { token })).json).toEqual({ trusted: true });
    expect((await helper.post("/api/invites/accept", { token })).status).toBe(400);
    expect((await helper.get(`/api/phones/${phone.id}`)).status).toBe(404);
    expect((await helper.get("/api/people-i-help")).json.people).toMatchObject([{ id: phone.id, name: "My phone" }]);
    const email = await start(qr.parent);
    await email.claim();
    expect((await email.decide("confirm", { keyType: "trusted", trustedEmail: "claimer@example.org" })).status).toBe(400);
    expect((await email.decide("confirm", { keyType: "trusted", trustedEmail: "email-helper@example.org" })).status).toBe(200);
    expect(h.mail.outbox.at(-1)?.to).toBe("email-helper@example.org");
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

  it("does not reopen the undo window for an older or already completed Self phone", async () => {
    const { parent, device, decide, claim } = await start();
    const claimed = await claim();
    device.token = (await decide("confirm")).json.deviceToken;
    expect((await device.get("/api/device/rules")).status).toBe(200);
    h.clock.advance(120_000);
    expect((await device.post("/api/device/setup-completion", { elapsedMs: 120_000 })).json).toEqual({ undoRemainingMs: 480_000 });
    h.clock.advance(480_000);
    expect((await device.get("/api/device/setup-completion")).json).toEqual({ undoRemainingMs: 0 });
    expect((await device.post("/api/device/setup-completion", { elapsedMs: 0 })).json).toEqual({ undoRemainingMs: 0 });
    expect((await device.post("/api/device/undo-setup/authorize")).status).toBe(409);
    expect((await device.post("/api/device/undo-setup")).status).toBe(409);
    h.clock.advance(60 * 60_000);
    expect((await device.post("/api/device/undo-setup")).status).toBe(409);
    expect((await parent.get(`/api/phones/${claimed.json.id}`)).status).toBe(200);
  });

  it("refuses to start the undo window for an old phone that never registered completion", async () => {
    const { device, decide, claim } = await start();
    await claim();
    device.token = (await decide("confirm")).json.deviceToken;
    expect((await device.get("/api/device/rules")).status).toBe(200);
    h.clock.advance(60 * 60_000);
    expect((await device.post("/api/device/setup-completion", { elapsedMs: 0 })).json).toEqual({ undoRemainingMs: 0 });
    expect((await device.post("/api/device/undo-setup/authorize")).status).toBe(409);
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
