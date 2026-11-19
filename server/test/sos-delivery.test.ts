// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { householdMembers, phones, pushSubscriptions, sosDeliveries, sosEvents } from "../src/db/schema.js";
import { deliverSos } from "../src/services/sos.js";
import { sweep } from "../src/services/sweeper.js";
import { Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

async function twoParents() {
  const parent = await signIn(h, "parent@example.org");
  const second = await signIn(h, "second@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile: "child" });
  const [first, other] = await Promise.all([parent, second].map(async (who) => (await who.get("/api/me")).json.user.id));
  const [row] = await h.ctx.db.select().from(phones).where(eq(phones.id, phoneId));
  await h.ctx.db.insert(householdMembers).values({ householdId: row!.householdId, userId: other, role: "parent" });
  await h.ctx.db.insert(pushSubscriptions).values([
    { userId: first, platform: "web", endpoint: "https://example.test/one" },
    { userId: other, platform: "web", endpoint: "https://example.test/two" },
  ]);
  return { parent, phoneId, device };
}

it("retries only the parent whose delivery failed and then closes the incident", async () => {
  const { device } = await twoParents();
  const real = h.parentPush.send.bind(h.parentPush);
  let down = true;
  const push = vi.spyOn(h.parentPush, "send").mockImplementation(async (target, msg, opts) =>
    target.endpoint.endsWith("/two") && down ? "failed" : real(target, msg, opts));
  const mail = vi.spyOn(h.mail, "send").mockImplementation(async (m) => {
    if (m.to === "second@example.org") throw new Error("unavailable");
    h.mail.outbox.push(m);
  });
  const mailBefore = h.mail.outbox.length;
  try {
    const id = randomUUID();
    expect((await device.post("/api/device/sos", { id, kind: "urgent" })).status).toBe(200);
    await vi.waitFor(async () => {
      const [open] = await h.ctx.db.select().from(sosEvents).where(eq(sosEvents.id, id));
      expect(open!.notificationLeaseUntil).not.toBeNull();
    });
    // Only the first parent has a completed delivery.
    expect(await h.ctx.db.select().from(sosDeliveries)).toHaveLength(1);
    expect(h.parentPush.sent.map((e) => e.endpoint)).toEqual(["https://example.test/one"]);
    let [event] = await h.ctx.db.select().from(sosEvents).where(eq(sosEvents.id, id));
    expect(event!.notificationClaimedAt).toBeNull();
    // Nothing is retried before the backoff has passed.
    await sweep(h.ctx);
    expect(push).toHaveBeenCalledTimes(2);
    down = false;
    mail.mockImplementation(async (m) => { h.mail.outbox.push(m); });
    h.clock.advance(60_000);
    await sweep(h.ctx);
    // Only the second parent is retried; the first is not sent again.
    expect(h.parentPush.sent.map((e) => e.endpoint)).toEqual(["https://example.test/one", "https://example.test/two"]);
    expect(h.mail.outbox.slice(mailBefore).map((m) => m.to).sort()).toEqual(["parent@example.org", "second@example.org"]);
    [event] = await h.ctx.db.select().from(sosEvents).where(eq(sosEvents.id, id));
    expect(event!.notificationClaimedAt).not.toBeNull();
    expect(event!.deliveryFailedAt).toBeNull();
    await sweep(h.ctx);
    expect(h.parentPush.sent).toHaveLength(2);
  } finally {
    push.mockRestore();
    mail.mockRestore();
  }
});

it("does not let temporary push errors delete a subscription, even over many retries", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { device } = await pairPhone(h, parent, { profile: "child" });
  const { user } = (await parent.get("/api/me")).json;
  await h.ctx.db.insert(pushSubscriptions).values({ userId: user.id, platform: "web", endpoint: "https://example.test/solo" });
  const real = h.parentPush.send.bind(h.parentPush);
  let down = true;
  const push = vi.spyOn(h.parentPush, "send").mockImplementation(async (t, m, o) => (down ? "failed" : real(t, m, o)));
  const mailOff = vi.spyOn(h.mail, "canSend", "get").mockReturnValue(false as never);
  try {
    for (let i = 0; i < 3; i++) expect((await device.post("/api/device/sos", { id: randomUUID(), kind: "urgent" })).status).toBe(200);
    for (let i = 0; i < 12; i++) {
      h.clock.advance(60_000);
      await sweep(h.ctx);
    }
    expect(push.mock.calls.length).toBeGreaterThan(20);
    const [sub] = await h.ctx.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id));
    expect(sub).toBeDefined();
    expect(sub!.failures).toBe(0);
    down = false;
    h.clock.advance(60_000);
    await sweep(h.ctx);
    expect(h.parentPush.sent).toHaveLength(3);
  } finally {
    push.mockRestore();
    mailOff.mockRestore();
  }
});

it("lets an install whose session expired remove its own app token, but not a web subscription", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { user } = (await parent.get("/api/me")).json;
  const token = "ExponentPushToken[example1234567890]";
  await h.ctx.db.insert(pushSubscriptions).values([
    { userId: user.id, platform: "expo", endpoint: token },
    { userId: user.id, platform: "web", endpoint: "https://example.test/browser" },
  ]);
  const anonymous = new Client(h);
  expect((await anonymous.post("/api/notifications/subscriptions/revoke", { token: "https://example.test/browser" })).status).toBe(204);
  expect(await h.ctx.db.select().from(pushSubscriptions)).toHaveLength(2);
  expect((await anonymous.post("/api/notifications/subscriptions/revoke", { token })).status).toBe(204);
  expect((await h.ctx.db.select().from(pushSubscriptions)).map((row) => row.platform)).toEqual(["web"]);
  expect((await anonymous.post("/api/notifications/subscriptions/revoke", { token })).status).toBe(204);
});

it("still deletes a subscription the provider reports as gone", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { device } = await pairPhone(h, parent, { profile: "child" });
  const { user } = (await parent.get("/api/me")).json;
  await h.ctx.db.insert(pushSubscriptions).values({ userId: user.id, platform: "web", endpoint: "https://example.test/dead" });
  h.parentPush.gone.add("https://example.test/dead");
  expect((await device.post("/api/device/sos", { id: randomUUID(), kind: "urgent" })).status).toBe(200);
  await vi.waitFor(async () => expect(await h.ctx.db.select().from(pushSubscriptions)).toEqual([]));
});

it("bounds a hung mail provider and never repeats a push that already went out", async () => {
  const { device } = await twoParents();
  const mail = vi.spyOn(h.mail, "send").mockImplementation(() => new Promise<void>(() => {}));
  try {
    const id = randomUUID();
    expect((await device.post("/api/device/sos", { id, kind: "urgent" })).status).toBe(200);
    // The request's own dispatch has a 20 s send timeout; pushes land at once.
    await vi.waitFor(() => expect(h.parentPush.sent).toHaveLength(2));
    const [event] = await h.ctx.db.select().from(sosEvents).where(eq(sosEvents.id, id));
    // Take over as the sweeper would after the lease, with a short timeout.
    await h.ctx.db.update(sosEvents).set({ notificationLeaseUntil: null, notificationClaimedAt: null }).where(eq(sosEvents.id, id));
    await deliverSos(h.ctx, id, event!.phoneId, { sendTimeoutMs: 50 });
    expect(h.parentPush.sent).toHaveLength(2);
    // Reached by push, so the hung mail does not keep the incident open.
    const rows = await h.ctx.db.select().from(sosDeliveries);
    expect(rows.every((row) => row.pushedAt && row.doneAt)).toBe(true);
    h.clock.advance(300_000);
    await sweep(h.ctx);
    expect(h.parentPush.sent).toHaveLength(2);
  } finally {
    mail.mockRestore();
  }
});

it("closes an undeliverable incident at the final timeout and shows it as not delivered", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile: "child" });
  const { user } = (await parent.get("/api/me")).json;
  await h.ctx.db.insert(pushSubscriptions).values({ userId: user.id, platform: "web", endpoint: "https://example.test/never" });
  const push = vi.spyOn(h.parentPush, "send").mockResolvedValue("failed");
  const mailOff = vi.spyOn(h.mail, "canSend", "get").mockReturnValue(false as never);
  try {
    const id = randomUUID();
    expect((await device.post("/api/device/sos", { id, kind: "urgent" })).status).toBe(200);
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => {
      const [open] = await h.ctx.db.select().from(sosEvents).where(eq(sosEvents.id, id));
      expect(open!.notificationLeaseUntil).not.toBeNull();
    });
    expect((await parent.get(`/api/phones/${phoneId}/sos`)).json.events[0].deliveryFailedAt).toBeNull();
    h.clock.advance(6 * 3_600_000 + 1);
    await sweep(h.ctx);
    expect((await parent.get(`/api/phones/${phoneId}/sos`)).json.events[0].deliveryFailedAt).toBeTruthy();
    const calls = push.mock.calls.length;
    await sweep(h.ctx);
    expect(push.mock.calls.length).toBe(calls);
  } finally {
    push.mockRestore();
    mailOff.mockRestore();
  }
});
