// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { householdMembers, phones, pushSubscriptions, sosDeliveries, sosEvents } from "../src/db/schema.js";
import { deliverSos } from "../src/services/sos.js";
import { sweep } from "../src/services/sweeper.js";
import { Client, pairPhone, signIn, useHarness, waitForSosRetryBackoff } from "./harness.js";

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
      // The lease starts at two minutes and drops to the one-minute retry backoff once the pass is over.
      expect(open!.notificationLeaseUntil?.getTime()).toBe(h.clock.now.getTime() + 60_000);
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

it("lets a timed-out SOS mail finish, records it, and never sends it twice", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile: "child" });
  const id = randomUUID();
  let finish!: () => void;
  // The first try fails at once; the second is slow and gets through after its attempt timed out.
  const mail = vi.spyOn(h.mail, "send")
    .mockRejectedValueOnce(new Error("unavailable"))
    .mockImplementationOnce((m) => new Promise<void>((resolve) => (finish = () => { h.mail.outbox.push(m); resolve(); })));
  const retry = async () => {
    await h.ctx.db.update(sosEvents).set({ notificationLeaseUntil: null }).where(eq(sosEvents.id, id));
    await deliverSos(h.ctx, id, phoneId, { sendTimeoutMs: 50 });
  };
  const before = h.mail.outbox.length;
  try {
    expect((await device.post("/api/device/sos", { id, kind: "urgent" })).status).toBe(200);
    await waitForSosRetryBackoff(h, id);
    await retry(); // the slow send starts and outlives the 50 ms
    expect(mail).toHaveBeenCalledTimes(2);
    expect(await h.ctx.db.select().from(sosDeliveries)).toEqual([]);
    await retry(); // still with the mail server: waited for, not sent again
    expect(mail).toHaveBeenCalledTimes(2);

    finish();
    await vi.waitFor(async () => expect((await h.ctx.db.select().from(sosDeliveries))[0]?.mailedAt).toBeTruthy());
    await waitForLeaseReleased(id);
    await retry(); // the late mail counts: the parent is reached and the incident closes
    expect(mail).toHaveBeenCalledTimes(2);
    expect(h.mail.outbox.slice(before).map((m) => m.to)).toEqual(["parent@example.org"]);
    const [event] = await h.ctx.db.select().from(sosEvents).where(eq(sosEvents.id, id));
    expect(event!.notificationClaimedAt).not.toBeNull();
  } finally {
    mail.mockRestore();
  }
});

/** Once a late SOS mail settles, its hold on the lease is let go so the next sweep picks it up. */
async function waitForLeaseReleased(id: string) {
  await vi.waitFor(async () => {
    const [open] = await h.ctx.db.select().from(sosEvents).where(eq(sosEvents.id, id));
    expect(open!.notificationLeaseUntil?.getTime()).toBe(h.clock.now.getTime());
  });
}

/** An SOS whose first mail fails at once and whose second is slow, released with the returned finish. */
async function slowSecondMail() {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile: "child" });
  const id = randomUUID();
  const slow = { finish: () => {} };
  const mail = vi.spyOn(h.mail, "send")
    .mockRejectedValueOnce(new Error("unavailable"))
    .mockImplementationOnce((m) => new Promise<void>((resolve) => (slow.finish = () => { h.mail.outbox.push(m); resolve(); })));
  const before = h.mail.outbox.length;
  expect((await device.post("/api/device/sos", { id, kind: "urgent" })).status).toBe(200);
  await waitForSosRetryBackoff(h, id);
  return { parent, phoneId, id, mail, slow, sent: () => h.mail.outbox.slice(before).map((m) => m.to) };
}

it("keeps other server processes from sending a slow SOS mail a second time", async () => {
  const { phoneId, id, mail, slow, sent } = await slowSecondMail();
  // A second process: same database, its own memory of what is in flight.
  const other: typeof h.ctx = { ...h.ctx };
  try {
    h.clock.advance(60_000);
    await deliverSos(h.ctx, id, phoneId, { sendTimeoutMs: 50 }); // the slow send outlives the 50 ms
    expect(mail).toHaveBeenCalledTimes(2);
    // Past the retry backoff and nearly the whole lease, the other process still keeps away.
    h.clock.advance(60_000);
    await sweep(other);
    h.clock.advance(59_000);
    await sweep(other);
    expect(mail).toHaveBeenCalledTimes(2);

    slow.finish();
    await waitForLeaseReleased(id);
    await sweep(other); // the other process now finds the mail recorded and closes the incident
    expect(mail).toHaveBeenCalledTimes(2);
    expect(sent()).toEqual(["parent@example.org"]);
    const [event] = await h.ctx.db.select().from(sosEvents).where(eq(sosEvents.id, id));
    expect(event!.notificationClaimedAt).not.toBeNull();
  } finally {
    mail.mockRestore();
  }
});

it("does not give up on an SOS while its mail is still with the mail server", async () => {
  const { parent, phoneId, id, mail, slow, sent } = await slowSecondMail();
  try {
    h.clock.advance(6 * 3_600_000 + 1);
    await deliverSos(h.ctx, id, phoneId, { sendTimeoutMs: 50 });
    expect(mail).toHaveBeenCalledTimes(2);
    let [event] = await h.ctx.db.select().from(sosEvents).where(eq(sosEvents.id, id));
    expect(event!.deliveryFailedAt).toBeNull();
    expect(event!.notificationClaimedAt).toBeNull();

    slow.finish();
    await waitForLeaseReleased(id);
    await sweep(h.ctx);
    [event] = await h.ctx.db.select().from(sosEvents).where(eq(sosEvents.id, id));
    expect(event!.notificationClaimedAt).not.toBeNull();
    expect((await parent.get(`/api/phones/${phoneId}/sos`)).json.events[0].deliveryFailedAt).toBeNull();
    expect(sent()).toEqual(["parent@example.org"]);
  } finally {
    mail.mockRestore();
  }
});

it("does not give up on an SOS whose late mail got through while another parent was waited for", async () => {
  const { phoneId, device } = await twoParents();
  const real = h.parentPush.send.bind(h.parentPush);
  let pushUp = false;
  const push = vi.spyOn(h.parentPush, "send").mockImplementation(async (target, msg, opts) =>
    pushUp && target.endpoint.endsWith("/two") ? real(target, msg, opts) : "failed");
  const slow = { finish: () => {} };
  const mail = vi.spyOn(h.mail, "send")
    .mockRejectedValueOnce(new Error("unavailable"))
    .mockRejectedValueOnce(new Error("unavailable"));
  const insert = h.ctx.db.insert.bind(h.ctx.db);
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let held = false;
  let lag: { mockRestore(): void } | undefined;
  const before = h.mail.outbox.length;
  try {
    const id = randomUUID();
    expect((await device.post("/api/device/sos", { id, kind: "urgent" })).status).toBe(200);
    await waitForSosRetryBackoff(h, id);
    // Next attempt: the first parent's mail is slow, and recording the second parent's push is too.
    pushUp = true;
    mail.mockImplementation(async (m) => {
      if (m.to === "second@example.org") throw new Error("unavailable");
      await new Promise<void>((resolve) => (slow.finish = () => { h.mail.outbox.push(m); resolve(); }));
    });
    lag = vi.spyOn(h.ctx.db, "insert").mockImplementation(((table: Parameters<typeof insert>[0]) => {
      if (table !== sosDeliveries || held) return insert(table);
      held = true;
      return {
        values: (v: never) => ({ onConflictDoUpdate: (o: never) => gate.then(() => insert(table).values(v).onConflictDoUpdate(o)) }),
      };
    }) as never);
    h.clock.advance(6 * 3_600_000 + 1);
    const attempt = deliverSos(h.ctx, id, phoneId, { sendTimeoutMs: 50 });
    await new Promise((resolve) => setTimeout(resolve, 150)); // the first parent's mail has timed out
    slow.finish();
    await vi.waitFor(async () => {
      const rows = await h.ctx.db.select().from(sosDeliveries).where(eq(sosDeliveries.eventId, id));
      expect(rows.some((row) => row.mailedAt)).toBe(true);
    });
    open();
    await attempt;
    const [event] = await h.ctx.db.select().from(sosEvents).where(eq(sosEvents.id, id));
    expect(event!.deliveryFailedAt).toBeNull();
    expect(event!.notificationClaimedAt).not.toBeNull();
    expect(h.mail.outbox.slice(before).map((m) => m.to)).toEqual(["parent@example.org"]);
  } finally {
    lag?.mockRestore();
    push.mockRestore();
    mail.mockRestore();
  }
});

it("releases a held lease after a renewal that was still in flight", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const { phoneId, id, mail, slow } = await slowSecondMail();
  const update = h.ctx.db.update.bind(h.ctx.db);
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let late: { mockRestore(): void } | undefined;
  try {
    h.clock.advance(60_000);
    await deliverSos(h.ctx, id, phoneId, { sendTimeoutMs: 50 }); // the slow send holds the lease
    // The renewal reaches the database, but its answer is late.
    let renewal = false;
    late = vi.spyOn(h.ctx.db, "update").mockImplementation(((table: Parameters<typeof update>[0]) => {
      const query = update(table);
      if (renewal) return query;
      renewal = true;
      return {
        set: (v: never) => ({ where: (w: never) => ({
          returning: (r: never) => query.set(v).where(w).returning(r).then(async (rows) => { await gate; return rows; }),
        }) }),
      };
    }) as never);
    h.clock.advance(30_000);
    vi.advanceTimersByTime(40_000);
    await vi.waitFor(async () => {
      const [event] = await h.ctx.db.select().from(sosEvents).where(eq(sosEvents.id, id));
      expect(event!.notificationLeaseUntil?.getTime()).toBe(h.clock.now.getTime() + 120_000);
    });
    slow.finish();
    await vi.waitFor(async () => expect((await h.ctx.db.select().from(sosDeliveries))[0]?.mailedAt).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 50)); // the release is under way
    open();
    await waitForLeaseReleased(id);
  } finally {
    vi.useRealTimers();
    late?.mockRestore();
    mail.mockRestore();
  }
});

it("records an accepted SOS mail again, without resending it, when the first record fails", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile: "child" });
  const id = randomUUID();
  const mail = vi.spyOn(h.mail, "send");
  const insert = h.ctx.db.insert.bind(h.ctx.db);
  let down = true;
  const lost = vi.spyOn(h.ctx.db, "insert").mockImplementation(((table: Parameters<typeof insert>[0]) => {
    if (table === sosDeliveries && down) {
      down = false;
      throw new Error("connection lost");
    }
    return insert(table);
  }) as typeof h.ctx.db.insert);
  const before = h.mail.outbox.length;
  try {
    expect((await device.post("/api/device/sos", { id, kind: "urgent" })).status).toBe(200);
    await waitForSosRetryBackoff(h, id);
    expect(mail).toHaveBeenCalledTimes(1);
    expect(await h.ctx.db.select().from(sosDeliveries)).toEqual([]);

    h.clock.advance(60_000);
    await sweep(h.ctx);
    expect(mail).toHaveBeenCalledTimes(1);
    expect(h.mail.outbox.slice(before).map((m) => m.to)).toEqual(["parent@example.org"]);
    expect((await h.ctx.db.select().from(sosDeliveries))[0]?.mailedAt).toBeTruthy();
    const [event] = await h.ctx.db.select().from(sosEvents).where(eq(sosEvents.id, id));
    expect(event!.notificationClaimedAt).not.toBeNull();
  } finally {
    lost.mockRestore();
    mail.mockRestore();
  }
});

it("counts the final timeout from when the server received the report, not the phone's own clock", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile: "child" });
  const { user } = (await parent.get("/api/me")).json;
  await h.ctx.db.insert(pushSubscriptions).values({ userId: user.id, platform: "web", endpoint: "https://example.test/late" });
  const push = vi.spyOn(h.parentPush, "send").mockResolvedValue("failed");
  const mailOff = vi.spyOn(h.mail, "canSend", "get").mockReturnValue(false as never);
  try {
    const id = randomUUID();
    // The phone was offline for seven hours and reports the SOS late.
    const sentAt = new Date(h.clock.now.getTime() - 7 * 3_600_000).toISOString();
    expect((await device.post("/api/device/sos", { id, kind: "urgent", sentAt })).status).toBe(200);
    await waitForSosRetryBackoff(h, id);
    expect((await parent.get(`/api/phones/${phoneId}/sos`)).json.events[0].deliveryFailedAt).toBeNull();
    h.clock.advance(60_000);
    await sweep(h.ctx);
    expect(push).toHaveBeenCalledTimes(2);
    expect((await parent.get(`/api/phones/${phoneId}/sos`)).json.events[0].deliveryFailedAt).toBeNull();
  } finally {
    push.mockRestore();
    mailOff.mockRestore();
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
    await waitForSosRetryBackoff(h, id);
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
