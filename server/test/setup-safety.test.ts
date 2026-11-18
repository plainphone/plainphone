// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { setupUndoNotices } from "../src/db/schema.js";
import { deliverSetupUndoNotices } from "../src/services/setup-undo-notices.js";
import { sweep } from "../src/services/sweeper.js";
import { Client, signIn, useHarness } from "./harness.js";

describe("onboarding safety", () => {
  const h = useHarness();

  async function start(account?: Client, mode: "light" | "strong" = "light", profile = "self") {
    const parent = account ?? await signIn(h, "claimer@example.org");
    const device = new Client(h);
    const result = await device.post("/api/device/pairings", { mode, profile, confirmOnPhone: true });
    expect(result.status).toBe(201);
    const { code, pairingId, pollSecret } = result.json;
    const path = `/api/device/pairings/${pairingId}`;
    const headers = { "x-poll-secret": pollSecret };
    return {
      parent, device, code,
      poll: () => device.get(path, headers),
      decide: (action: string) => device.call("POST", path, { action }, headers),
      claim: (chosenProfile = profile) => parent.post("/api/phones/claim", { code, profile: chosenProfile, name: "My phone" }),
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
    expect((await device.get("/api/device/rules")).status).toBe(200);
    h.clock.advance(48 * 60 * 60_000);
    const before = h.mail.outbox.length;
    const path = "/api/device/undo-setup";
    const reports = await Promise.all([device.post(path), device.post(path)]);
    expect(reports.map(({ status }) => status)).toContain(204);
    expect((await device.post(path)).status).toBe(401);
    expect((await parent.get(`/api/phones/${claimed.json.id}`)).status).toBe(404);
    await sweep(h.ctx);
    const notices = h.mail.outbox.slice(before);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.to).toBe("claimer@example.org");
    expect(notices[0]?.text).toContain("Set-up was undone on the phone");
  });

  it("rejects setup undo after 48 hours and still allows dashboard release", async () => {
    const { parent, device, decide, claim } = await start(undefined, "light", "child");
    const claimed = await claim();
    device.token = (await decide("confirm")).json.deviceToken;
    expect((await device.get("/api/device/rules")).status).toBe(200);
    h.clock.advance(48 * 60 * 60_000 + 1);
    const phone = `/api/phones/${claimed.json.id}`;

    expect((await device.post("/api/device/undo-setup")).status).toBe(409);
    expect((await parent.get(phone)).status).toBe(200);
    expect(await h.ctx.db.select().from(setupUndoNotices)).toHaveLength(0);
    expect((await device.post("/api/device/released")).status).toBe(409);
    expect((await parent.post(`${phone}/release`)).status).toBe(200);
    expect((await device.post("/api/device/released")).status).toBe(204);
  });

  it("recovers an unsent notice after the phone deletion is committed", async () => {
    const { parent, device, decide, claim } = await start();
    const claimed = await claim();
    device.token = (await decide("confirm")).json.deviceToken;
    expect((await device.get("/api/device/rules")).status).toBe(200);
    expect((await parent.post("/api/notifications/subscriptions", {
      platform: "web", endpoint: "https://fcm.googleapis.com/test", keys: { p256dh: "A".repeat(87), auth: "A".repeat(22) },
    })).status).toBe(201);
    const before = h.mail.outbox.length;
    expect((await device.post("/api/device/undo-setup")).status).toBe(204);
    expect((await parent.get(`/api/phones/${claimed.json.id}`)).status).toBe(404);
    expect((await device.post("/api/device/undo-setup")).status).toBe(401);
    expect(h.mail.outbox).toHaveLength(before);

    const send = vi.spyOn(h.mail, "send").mockRejectedValue(new Error("mail unavailable"));
    await sweep(h.ctx);
    expect(h.mail.outbox).toHaveLength(before);
    expect(h.parentPush.sent).toHaveLength(1);

    send.mockRestore();
    h.clock.advance(60_000);
    await Promise.all([sweep(h.ctx), sweep(h.ctx)]);
    await sweep(h.ctx);
    expect(h.mail.outbox.slice(before).map((notice) => notice.text))
      .toEqual([expect.stringContaining("Set-up was undone on the phone")]);
    expect(h.parentPush.sent.map(({ msg }) => msg.body)).toEqual(["Set-up was undone on the phone."]);
  });

  it("drops a queued notice when the recipient is removed from the household", async () => {
    const { parent, device, decide, claim } = await start();
    const household = (await parent.get("/api/me")).json.households[0];
    await parent.post(`/api/households/${household.id}/invites`, { email: "member@example.org" });
    const token = decodeURIComponent(/invite#token=(\S+)/.exec(h.mail.outbox.at(-1)!.text)![1]!);
    const member = await signIn(h, "member@example.org");
    expect((await member.post("/api/invites/accept", { token })).status).toBe(200);
    expect((await member.post("/api/notifications/subscriptions", {
      platform: "web", endpoint: "https://fcm.googleapis.com/member", keys: { p256dh: "A".repeat(87), auth: "A".repeat(22) },
    })).status).toBe(201);

    expect((await claim()).status).toBe(201);
    device.token = (await decide("confirm")).json.deviceToken;
    expect((await device.get("/api/device/rules")).status).toBe(200);
    expect((await device.post("/api/device/undo-setup")).status).toBe(204);
    const memberId = (await member.get("/api/me")).json.user.id;
    expect((await parent.call("DELETE", `/api/households/${household.id}/members/${memberId}`)).status).toBe(204);

    const before = h.mail.outbox.length;
    await sweep(h.ctx);
    expect(h.mail.outbox.slice(before).map(({ to }) => to)).toEqual(["claimer@example.org"]);
    expect(h.parentPush.sent).toHaveLength(0);
  });

  it("delivers at most ten undo notices per sweep", async () => {
    const { device, decide, claim } = await start();
    const before = h.mail.outbox.length;
    expect((await claim()).status).toBe(201);
    device.token = (await decide("confirm")).json.deviceToken;
    expect((await device.get("/api/device/rules")).status).toBe(200);
    expect((await device.post("/api/device/undo-setup")).status).toBe(204);
    const [notice] = await h.ctx.db.select().from(setupUndoNotices);
    await h.ctx.db.insert(setupUndoNotices).values(Array.from({ length: 10 }, () => ({ ...notice!, id: undefined })));

    await sweep(h.ctx);
    expect(h.mail.outbox).toHaveLength(before + 10);
    await sweep(h.ctx);
    expect(h.mail.outbox).toHaveLength(before + 11);
  });

  it("releases a claim when its budget expires before sending", async () => {
    const { device, decide, claim } = await start();
    expect((await claim()).status).toBe(201);
    device.token = (await decide("confirm")).json.deviceToken;
    expect((await device.get("/api/device/rules")).status).toBe(200);
    expect((await device.post("/api/device/undo-setup")).status).toBe(204);

    const before = h.mail.outbox.length;
    const elapsed = vi.spyOn(performance, "now").mockReturnValue(0);
    const update = h.ctx.db.update.bind(h.ctx.db);
    const claimUpdate = vi.spyOn(h.ctx.db, "update").mockImplementationOnce((table) => {
      elapsed.mockReturnValue(10_000);
      return update(table);
    });
    try {
      await deliverSetupUndoNotices(h.ctx);
      expect(claimUpdate).toHaveBeenCalledTimes(2);
      expect(h.mail.outbox).toHaveLength(before);
    } finally {
      claimUpdate.mockRestore();
      elapsed.mockRestore();
    }
    await deliverSetupUndoNotices(h.ctx);
    expect(h.mail.outbox).toHaveLength(before + 1);
  });

  it("ends the notice batch while a slow delivery is still in flight", async () => {
    const { device, decide, claim } = await start();
    expect((await claim()).status).toBe(201);
    device.token = (await decide("confirm")).json.deviceToken;
    expect((await device.get("/api/device/rules")).status).toBe(200);
    expect((await device.post("/api/device/undo-setup")).status).toBe(204);
    const [notice] = await h.ctx.db.select().from(setupUndoNotices);
    await h.ctx.db.insert(setupUndoNotices).values({ ...notice!, id: undefined });
    let finish!: () => void;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const sending = new Promise<void>((resolve) => { started = resolve; });
    const send = vi.spyOn(h.mail, "send").mockImplementation(() => {
      started();
      return pending;
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let returned = false;
      const batch = deliverSetupUndoNotices(h.ctx).then(() => { returned = true; });
      await sending;
      await vi.advanceTimersByTimeAsync(9_999);
      expect(returned).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(returned).toBe(true);
      await batch;
      expect(send).toHaveBeenCalledTimes(1);

      const remove = vi.spyOn(h.ctx.db, "delete").mockImplementationOnce(() => {
        throw new Error("database unavailable");
      });
      try {
        finish();
        await Promise.resolve();
        await Promise.resolve();
        expect(log).toHaveBeenCalledWith("setup undo notice batch failed after its deadline");
        expect(send).toHaveBeenCalledTimes(1);
      } finally {
        remove.mockRestore();
      }
    } finally {
      finish();
      vi.useRealTimers();
      log.mockRestore();
      send.mockRestore();
    }
  });

  it("keeps Device Owner paired when it reports a setup undo", async () => {
    const { parent, device, decide, claim } = await start(undefined, "strong");
    const claimed = await claim();
    device.token = (await decide("confirm")).json.deviceToken;
    expect((await device.get("/api/device/rules")).status).toBe(200);
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
